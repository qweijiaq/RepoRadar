import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import type { Pool as PgPool } from 'pg'
import type { EnrichedRepoRecord, RepoInput, RepoRecord } from './types.js'
import { parseVector } from './utils.js'

const { Pool } = pg

export type DbPool = PgPool

export function createPool(databaseUrl: string): DbPool {
  return new Pool({ connectionString: databaseUrl, max: 5 })
}

const MIGRATION_LOCK_ID = 728412

/**
 * 按版本执行 migrations 目录下的 SQL。已应用的迁移会记录 checksum，
 * 如果文件被修改，下一次启动会直接报错而不是静默跳过。
 */
export async function migrate(pool: DbPool): Promise<void> {
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'db', 'migrations')
  const files = (await readdir(dir))
    .filter((file) => file.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right))
  const client = await pool.connect()
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID])
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version TEXT PRIMARY KEY,
         checksum TEXT NOT NULL,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    )
    const applied = await client.query<{ version: string; checksum: string }>(
      `SELECT version, checksum FROM schema_migrations`,
    )
    const known = new Map(applied.rows.map((row) => [row.version, row.checksum]))

    for (const file of files) {
      const version = file.replace(/\.sql$/, '')
      const sql = await readFile(`${dir}/${file}`, 'utf8')
      const checksum = createHash('sha256').update(sql).digest('hex')
      const previous = known.get(version)
      if (previous) {
        if (previous !== checksum) {
          throw new Error(
            `迁移 ${version} 的文件内容已变化（已应用 checksum ${previous.slice(0, 12)}，当前 ${checksum.slice(0, 12)}）。请新增迁移文件，不要修改历史迁移。`,
          )
        }
        continue
      }
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query(
          `INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)`,
          [version, checksum],
        )
        await client.query('COMMIT')
        console.log(`[migrate] 已应用 ${version}`)
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw new Error(
          `迁移 ${version} 失败：${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        )
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => undefined)
    client.release()
  }
}

interface RepoRow {
  id: string
  github_id: string | null
  full_name: string
  owner: string
  name: string
  description: string | null
  html_url: string
  homepage: string | null
  language: string | null
  topics: string[] | null
  stars: number
  forks: number
  open_issues: number
  license: string | null
  archived: boolean
  is_fork: boolean
  pushed_at: Date | string | null
  created_at: Date | string | null
}

interface EnrichedRepoRow extends RepoRow {
  summary: string | null
  problem: string | null
  audience: string | null
  verdict: string | null
  reason: string | null
  quality_score: number | null
  stars_7d: number | null
  embedding: string | null
  semantic_score: number | null
  verify_status: string | null
  verified_at: Date | string | null
}

const REPO_COLUMNS = `repos.id, repos.github_id, repos.full_name, repos.owner, repos.name,
  repos.description, repos.html_url, repos.homepage, repos.language, repos.topics,
  repos.stars, repos.forks, repos.open_issues, repos.license, repos.archived, repos.is_fork,
  repos.pushed_at, repos.created_at`

function toIso(value: Date | string | null): string | null {
  if (value === null) return null
  return value instanceof Date ? value.toISOString() : value
}

function mapRepoRow(row: RepoRow): RepoRecord {
  return {
    id: Number(row.id),
    githubId: row.github_id === null ? null : Number(row.github_id),
    fullName: row.full_name,
    owner: row.owner,
    name: row.name,
    description: row.description,
    htmlUrl: row.html_url,
    homepage: row.homepage,
    language: row.language,
    topics: row.topics ?? [],
    stars: row.stars,
    forks: row.forks,
    openIssues: row.open_issues,
    license: row.license,
    archived: row.archived,
    isFork: row.is_fork,
    pushedAt: toIso(row.pushed_at),
    createdAt: toIso(row.created_at),
  }
}

function mapEnrichedRow(row: EnrichedRepoRow, withSemantic = false): EnrichedRepoRecord {
  return {
    ...mapRepoRow(row),
    summary: row.summary,
    problem: row.problem,
    audience: row.audience,
    verdict: row.verdict,
    reason: row.reason,
    qualityScore: row.quality_score,
    stars7d: row.stars_7d,
    embedding: parseVector(row.embedding),
    ...(withSemantic ? { semanticScore: row.semantic_score } : {}),
    verifyStatus: row.verify_status,
    verifiedAt: toIso(row.verified_at),
  }
}

async function updateRepoById(pool: DbPool, id: number, repo: RepoInput): Promise<void> {
  await pool.query(
    `UPDATE repos SET
       full_name = $2, owner = $3, name = $4, description = $5, html_url = $6, homepage = $7,
       language = $8, topics = $9, stars = $10, forks = $11, open_issues = $12, license = $13,
       archived = $14, is_fork = $15, pushed_at = $16, github_id = COALESCE($17, github_id),
       updated_at = now()
     WHERE id = $1`,
    [
      id,
      repo.fullName,
      repo.owner,
      repo.name,
      repo.description,
      repo.htmlUrl,
      repo.homepage,
      repo.language,
      repo.topics,
      repo.stars,
      repo.forks,
      repo.openIssues,
      repo.license,
      repo.archived,
      repo.isFork,
      repo.pushedAt,
      repo.githubId ?? null,
    ],
  )
}

export async function upsertRepo(pool: DbPool, repo: RepoInput): Promise<{ id: number; inserted: boolean }> {
  const githubId = repo.githubId ?? null

  // 优先按 GitHub 稳定 ID 找到同一仓库，这样改名/转移不会产生重复记录。
  if (githubId !== null) {
    const existing = await pool.query<{ id: string }>(
      `SELECT id FROM repos WHERE github_id = $1 LIMIT 1`,
      [githubId],
    )
    if (existing.rows[0]) {
      const id = Number(existing.rows[0].id)
      await updateRepoById(pool, id, repo)
      return { id, inserted: false }
    }
  }

  try {
    const { rows } = await pool.query<{ id: string; inserted: boolean }>(
      `INSERT INTO repos (
         full_name, github_id, owner, name, description, html_url, homepage, language, topics,
         stars, forks, open_issues, license, archived, is_fork, pushed_at, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, now())
       ON CONFLICT (full_name) DO UPDATE SET
         github_id = COALESCE(EXCLUDED.github_id, repos.github_id),
         owner = EXCLUDED.owner,
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         homepage = EXCLUDED.homepage,
         language = EXCLUDED.language,
         topics = EXCLUDED.topics,
         stars = EXCLUDED.stars,
         forks = EXCLUDED.forks,
         open_issues = EXCLUDED.open_issues,
         license = EXCLUDED.license,
         archived = EXCLUDED.archived,
         is_fork = EXCLUDED.is_fork,
         pushed_at = EXCLUDED.pushed_at,
         updated_at = now()
       RETURNING id, (xmax = 0) AS inserted`,
      [
        repo.fullName,
        githubId,
        repo.owner,
        repo.name,
        repo.description,
        repo.htmlUrl,
        repo.homepage,
        repo.language,
        repo.topics,
        repo.stars,
        repo.forks,
        repo.openIssues,
        repo.license,
        repo.archived,
        repo.isFork,
        repo.pushedAt,
        repo.createdAt,
      ],
    )
    const row = rows[0]
    if (!row) throw new Error(`保存仓库失败：${repo.fullName}`)
    return { id: Number(row.id), inserted: row.inserted }
  } catch (error) {
    // 极少数情况下，同一 ID 的仓库被并发插入，或旧数据按 full_name 占位。
    if (githubId !== null && (error as { code?: string }).code === '23505') {
      const existing = await pool.query<{ id: string }>(
        `SELECT id FROM repos WHERE github_id = $1 LIMIT 1`,
        [githubId],
      )
      if (existing.rows[0]) {
        const id = Number(existing.rows[0].id)
        await updateRepoById(pool, id, repo)
        return { id, inserted: false }
      }
    }
    throw error
  }
}

export async function saveSnapshot(pool: DbPool, repoId: number, stars: number): Promise<void> {
  await pool.query(
    `INSERT INTO star_snapshots (repo_id, captured_on, stars) VALUES ($1, CURRENT_DATE, $2)
     ON CONFLICT (repo_id, captured_on) DO UPDATE SET stars = EXCLUDED.stars`,
    [repoId, stars],
  )
}

export interface RepoIdentityRow {
  id: number
  fullName: string
}

export async function listReposMissingGithubId(pool: DbPool, limit = 50): Promise<RepoIdentityRow[]> {
  const { rows } = await pool.query<{ id: string; full_name: string }>(
    `SELECT id, full_name FROM repos
     WHERE github_id IS NULL
     ORDER BY updated_at DESC
     LIMIT $1`,
    [Math.max(1, Math.min(500, limit))],
  )
  return rows.map((row) => ({ id: Number(row.id), fullName: row.full_name }))
}

export async function setRepoGithubId(pool: DbPool, id: number, githubId: number): Promise<void> {
  await pool.query(`UPDATE repos SET github_id = $2, updated_at = now() WHERE id = $1`, [id, githubId])
}

export async function findPendingRepos(
  pool: DbPool,
  limit: number,
  options: { topics?: string[] } = {},
): Promise<RepoRecord[]> {
  const topics = options.topics && options.topics.length > 0 ? options.topics : null
  const { rows } = await pool.query<RepoRow>(
    `SELECT ${REPO_COLUMNS} FROM repos
     WHERE enriched_at IS NULL
       AND ($2::text[] IS NULL OR topics && $2::text[])
     ORDER BY stars DESC
     LIMIT $1`,
    [limit, topics],
  )
  return rows.map(mapRepoRow)
}

export async function findReposForMatching(
  pool: DbPool,
  options: { topics?: string[]; language?: string | null; keywords?: string[]; limit?: number },
): Promise<RepoRecord[]> {
  const topics = options.topics && options.topics.length > 0 ? options.topics : null
  const keywords = options.keywords?.filter(Boolean).slice(0, 6) ?? []
  const patterns = keywords.length > 0 ? keywords.map((keyword) => `%${keyword}%`) : null
  const limit = Math.max(1, Math.min(500, options.limit ?? 200))
  const { rows } = await pool.query<RepoRow>(
    `SELECT ${REPO_COLUMNS} FROM repos
     WHERE archived = FALSE AND is_fork = FALSE
       AND (
         ($1::text[] IS NOT NULL AND topics && $1::text[])
         OR ($2::text IS NOT NULL AND language ILIKE $2)
         OR (
           $3::text[] IS NOT NULL
           AND (
             full_name ILIKE ANY($3::text[])
             OR coalesce(description, '') ILIKE ANY($3::text[])
             OR EXISTS (SELECT 1 FROM unnest(topics) AS topic WHERE topic ILIKE ANY($3::text[]))
           )
         )
       )
     ORDER BY stars DESC
     LIMIT $4`,
    [topics, options.language || null, patterns, limit],
  )
  return rows.map(mapRepoRow)
}

export interface EnrichedQueryOptions {
  /**
   * 传入画像向量时，相似度直接由 pgvector 在库里计算，结果放在 semanticScore，
   * 调用方就不需要把 1536 维向量搬到应用层。
   */
  profileEmbedding?: number[] | null
  /** 明确不需要向量时设为 false。默认在传了画像向量后自动关闭。 */
  includeEmbedding?: boolean
  /** 在 SQL 层先按语言过滤，避免「先取前 500 再筛选」把小语种筛空。 */
  language?: string | null
  /** 只保留已通过沙箱验证的仓库。 */
  verifiedOnly?: boolean
}

/** 与 0001_initial.sql 里 repos.embedding 的维度保持一致。 */
const EMBEDDING_DIMENSIONS = 1536

function vectorLiteral(values: number[] | null | undefined): string | null {
  if (!values || values.length !== EMBEDDING_DIMENSIONS) return null
  return JSON.stringify(values)
}

export async function findEnrichedRepos(
  pool: DbPool,
  limit: number,
  options: EnrichedQueryOptions = {},
): Promise<EnrichedRepoRecord[]> {
  const profileEmbedding = vectorLiteral(options.profileEmbedding)
  const withSemantic = profileEmbedding !== null
  const withEmbedding = options.includeEmbedding ?? !withSemantic

  const conditions = ['repos.enriched_at IS NOT NULL']
  const values: unknown[] = [limit]
  const language = options.language?.trim()
  if (language) {
    values.push(language)
    conditions.push(`repos.language = $${values.length}`)
  }
  if (options.verifiedOnly) conditions.push(`repos.verify_status = 'verified'`)
  let semanticExpression = 'NULL::double precision'
  if (withSemantic) {
    values.push(profileEmbedding)
    semanticExpression = `CASE WHEN repos.embedding IS NULL THEN NULL ELSE 1 - (repos.embedding <=> $${values.length}::vector) END`
  }

  const { rows } = await pool.query<EnrichedRepoRow>(
    `WITH candidates AS (
       SELECT repos.id, repos.quality_score
       FROM repos
       WHERE ${conditions.join('\n         AND ')}
       ORDER BY repos.quality_score DESC NULLS LAST
       LIMIT $1
     ),
     recent_stars AS (
       SELECT DISTINCT ON (repo_id) repo_id, stars
       FROM star_snapshots
       WHERE repo_id IN (SELECT id FROM candidates)
         AND captured_on <= CURRENT_DATE - INTERVAL '7 days'
       ORDER BY repo_id, captured_on DESC
     )
     SELECT ${REPO_COLUMNS}, repos.summary, repos.problem, repos.audience, repos.verdict,
       repos.reason, repos.quality_score,
       recent_stars.stars AS stars_7d,
       ${withEmbedding ? 'repos.embedding::text' : 'NULL::text'} AS embedding,
       ${semanticExpression} AS semantic_score,
       repos.verify_status, repos.verified_at
     FROM candidates
     JOIN repos ON repos.id = candidates.id
     LEFT JOIN recent_stars ON recent_stars.repo_id = repos.id
     ORDER BY candidates.quality_score DESC NULLS LAST`,
    values,
  )
  return rows.map((row) => mapEnrichedRow(row, withSemantic))
}

export async function findRepoByFullName(pool: DbPool, fullName: string): Promise<EnrichedRepoRecord | null> {
  const { rows } = await pool.query<EnrichedRepoRow>(
    `SELECT ${REPO_COLUMNS}, summary, problem, audience, verdict, reason, quality_score,
       (SELECT s.stars FROM star_snapshots s
          WHERE s.repo_id = repos.id AND s.captured_on <= CURRENT_DATE - INTERVAL '7 days'
          ORDER BY s.captured_on DESC LIMIT 1) AS stars_7d,
       embedding::text AS embedding,
       verify_status, verified_at
     FROM repos
     WHERE full_name = $1
     LIMIT 1`,
    [fullName],
  )
  const row = rows[0]
  return row ? mapEnrichedRow(row) : null
}

export interface SearchEnrichedOptions {
  query?: string
  topic?: string
  language?: string
  limit?: number
}

export async function searchEnrichedRepos(
  pool: DbPool,
  options: SearchEnrichedOptions,
): Promise<EnrichedRepoRecord[]> {
  const pattern = options.query ? `%${options.query}%` : null
  const { rows } = await pool.query<EnrichedRepoRow>(
    `SELECT ${REPO_COLUMNS}, summary, problem, audience, verdict, reason, quality_score,
       (SELECT s.stars FROM star_snapshots s
          WHERE s.repo_id = repos.id AND s.captured_on <= CURRENT_DATE - INTERVAL '7 days'
          ORDER BY s.captured_on DESC LIMIT 1) AS stars_7d,
       embedding::text AS embedding,
       verify_status, verified_at
     FROM repos
     WHERE enriched_at IS NOT NULL
       AND ($1::text IS NULL OR full_name ILIKE $1 OR coalesce(summary, '') ILIKE $1 OR coalesce(description, '') ILIKE $1)
       AND ($2::text IS NULL OR EXISTS (SELECT 1 FROM unnest(topics) AS t WHERE lower(t) = lower($2)))
       AND ($3::text IS NULL OR language ILIKE $3)
     ORDER BY quality_score DESC NULLS LAST, stars DESC
     LIMIT $4`,
    [pattern, options.topic ?? null, options.language ?? null, options.limit ?? 20],
  )
  return rows.map((row) => mapEnrichedRow(row))
}

export interface EnrichmentUpdate {
  summary: string
  problem: string
  audience: string
  verdict: string
  reason: string
  qualityScore: number
  qualityDetail: unknown
  readmeHash: string | null
  embedding: number[] | null
}

export async function updateEnrichment(pool: DbPool, repoId: number, update: EnrichmentUpdate): Promise<void> {
  await pool.query(
    `UPDATE repos SET
       summary = $2, problem = $3, audience = $4, verdict = $5, reason = $6,
       quality_score = $7, quality_detail = $8, readme_hash = $9, embedding = $10::vector,
       enriched_at = now(), updated_at = now()
     WHERE id = $1`,
    [
      repoId,
      update.summary,
      update.problem,
      update.audience,
      update.verdict,
      update.reason,
      update.qualityScore,
      JSON.stringify(update.qualityDetail),
      update.readmeHash,
      update.embedding ? JSON.stringify(update.embedding) : null,
    ],
  )
}

export interface IngestStats {
  queryCount: number
  reposSeen: number
  reposNew: number
}

export async function startIngestRun(pool: DbPool): Promise<number> {
  const { rows } = await pool.query<{ id: string }>('INSERT INTO ingest_runs DEFAULT VALUES RETURNING id')
  const row = rows[0]
  if (!row) throw new Error('无法创建 ingest run')
  return Number(row.id)
}

export async function finishIngestRun(
  pool: DbPool,
  runId: number,
  stats: IngestStats,
  error: string | null = null,
): Promise<void> {
  await pool.query(
    `UPDATE ingest_runs SET finished_at = now(), query_count = $2, repos_seen = $3, repos_new = $4, error = $5
     WHERE id = $1`,
    [runId, stats.queryCount, stats.reposSeen, stats.reposNew, error],
  )
}

export interface VerificationTarget {
  fullName: string
  qualityScore: number | null
}

export async function findReposForVerification(
  pool: DbPool,
  options: { limit: number; minQuality?: number; repoFullName?: string },
): Promise<VerificationTarget[]> {
  const conditions = [
    'enriched_at IS NOT NULL',
    "verdict IS DISTINCT FROM 'skip'",
    '(verify_status IS NULL OR verified_at IS NULL OR verified_at < now() - INTERVAL \'7 days\')',
  ]
  const params: unknown[] = []

  if (options.repoFullName) {
    params.push(options.repoFullName)
    conditions.push(`full_name = $${params.length}`)
  }
  if (options.minQuality !== undefined) {
    params.push(options.minQuality)
    conditions.push(`quality_score >= $${params.length}`)
  }

  params.push(options.limit)
  const { rows } = await pool.query<{ full_name: string; quality_score: number | null }>(
    `SELECT full_name, quality_score FROM repos
     WHERE ${conditions.join(' AND ')}
     ORDER BY quality_score DESC NULLS LAST, stars DESC
     LIMIT $${params.length}`,
    params,
  )
  return rows.map((row) => ({ fullName: row.full_name, qualityScore: row.quality_score }))
}

export interface VerificationInput {
  repoFullName: string
  commitSha: string | null
  status: string
  stack: string
  commands: string[]
  exitCode: number | null
  durationMs: number
  logPath: string | null
  logTail: string
}

export async function saveVerification(pool: DbPool, input: VerificationInput): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO verifications (
       repo_full_name, commit_sha, status, stack, commands, exit_code, duration_ms, log_path, log_tail, verified_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
     RETURNING id`,
    [
      input.repoFullName,
      input.commitSha,
      input.status,
      input.stack,
      JSON.stringify(input.commands),
      input.exitCode,
      input.durationMs,
      input.logPath,
      input.logTail,
    ],
  )
  await pool.query(
    `UPDATE repos SET verify_status = $2, verified_at = now(), updated_at = now() WHERE full_name = $1`,
    [input.repoFullName, input.status],
  )
  return Number(rows[0]?.id ?? 0)
}

export interface VerificationRecord {
  id: number
  repoFullName: string
  commitSha: string | null
  status: string
  stack: string | null
  commands: string[]
  exitCode: number | null
  durationMs: number | null
  logPath: string | null
  logTail: string | null
  verifiedAt: string | null
}

interface VerificationRow {
  id: string
  repo_full_name: string
  commit_sha: string | null
  status: string
  stack: string | null
  commands: string[] | null
  exit_code: number | null
  duration_ms: number | null
  log_path: string | null
  log_tail: string | null
  verified_at: Date | string | null
}

export async function findLatestVerification(
  pool: DbPool,
  repoFullName: string,
): Promise<VerificationRecord | null> {
  const rows = await loadVerifications(pool, repoFullName, 1)
  return rows[0] ?? null
}

function mapVerificationRow(row: VerificationRow): VerificationRecord {
  return {
    id: Number(row.id),
    repoFullName: row.repo_full_name,
    commitSha: row.commit_sha,
    status: row.status,
    stack: row.stack,
    commands: row.commands ?? [],
    exitCode: row.exit_code,
    durationMs: row.duration_ms,
    logPath: row.log_path,
    logTail: row.log_tail,
    verifiedAt: toIso(row.verified_at),
  }
}

export async function loadVerifications(
  pool: DbPool,
  repoFullName: string,
  limit = 5,
): Promise<VerificationRecord[]> {
  const { rows } = await pool.query<VerificationRow>(
    `SELECT id, repo_full_name, commit_sha, status, stack, commands, exit_code, duration_ms,
            log_path, log_tail, verified_at
     FROM verifications
     WHERE repo_full_name = $1
     ORDER BY verified_at DESC
     LIMIT $2`,
    [repoFullName, limit],
  )
  return rows.map(mapVerificationRow)
}

export interface StarHistoryPoint {
  date: string
  stars: number
}

export async function loadStarHistory(pool: DbPool, repoId: number, days = 30): Promise<StarHistoryPoint[]> {
  const { rows } = await pool.query<{ captured_on: string; stars: number }>(
    `SELECT to_char(captured_on, 'YYYY-MM-DD') AS captured_on, stars
     FROM star_snapshots
     WHERE repo_id = $1 AND captured_on >= CURRENT_DATE - ($2::int * INTERVAL '1 day')
     ORDER BY captured_on`,
    [repoId, days],
  )
  return rows.map((row) => ({ date: row.captured_on, stars: row.stars }))
}

export async function loadRecentReleaseRepoNames(pool: DbPool, days = 7): Promise<Set<string>> {
  const { rows } = await pool.query<{ repo_full_name: string }>(
    `SELECT DISTINCT repo_full_name FROM release_events
     WHERE published_at >= now() - ($1::int * INTERVAL '1 day')`,
    [days],
  )
  return new Set(rows.map((row) => row.repo_full_name))
}
