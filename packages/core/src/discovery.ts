import type { LlmConfig } from './config.js'
import type { DbPool } from './db.js'
import {
  findPendingRepos,
  finishIngestRun,
  saveSnapshot,
  startIngestRun,
  updateEnrichment,
  upsertRepo,
} from './db.js'
import { enrichRepo } from './enrich.js'
import { buildSearchQueries, searchRepos, type SearchWindow } from './github.js'
import { fetchReadme } from './github.js'
import { hashReadme } from './enrich.js'
import { sleep } from './utils.js'

const SEARCH_WINDOWS: SearchWindow[] = [
  { min: 50, max: 500 },
  { min: 500, max: 5000 },
  { min: 5000, max: null },
]
const LAST_RUN_KEY = 'discovery.lastRun'

export interface IngestOptions {
  topics: string[]
  token?: string | null
  days?: number
  pages?: number
  perPage?: number
  delayMs?: number
  language?: string
  sort?: 'stars' | 'forks' | 'updated'
  freshDays?: number
}

export interface DiscoveryEnrichOptions {
  limit?: number
  topics?: string[]
  token?: string | null
  llm?: LlmConfig | null
}

export interface DiscoveryRun {
  at: string
  topics: string[]
  seen: number
  inserted: number
  enriched: number
  pending: number
}

export interface DiscoveryStatus {
  totalRepos: number
  enrichedRepos: number
  pendingRepos: number
  lastRun: DiscoveryRun | null
}

export async function ingestRepos(
  pool: DbPool,
  options: IngestOptions,
): Promise<{ seen: number; inserted: number }> {
  const topics = [...new Set(options.topics.map((topic) => topic.trim()).filter(Boolean))]
  if (topics.length === 0) return { seen: 0, inserted: 0 }
  const pages = Math.max(1, Math.min(5, options.pages ?? 1))
  const perPage = Math.max(5, Math.min(100, options.perPage ?? 30))
  const delayMs = Math.max(200, options.delayMs ?? 1200)
  const queries = buildSearchQueries({
    topics,
    days: options.days ?? 30,
    windows: SEARCH_WINDOWS,
    ...(options.language ? { language: options.language } : {}),
    ...(options.freshDays ? { freshDays: options.freshDays } : {}),
  })
  const runId = await startIngestRun(pool)
  let seen = 0
  let inserted = 0
  let queryCount = 0
  try {
    for (const query of queries) {
      queryCount++
      for (let page = 1; page <= pages; page++) {
        const repos = await searchRepos(query, {
          token: options.token ?? undefined,
          page,
          perPage,
          ...(options.sort ? { sort: options.sort } : {}),
        })
        for (const repo of repos) {
          if (repo.isFork || repo.archived) continue
          seen++
          const result = await upsertRepo(pool, repo)
          if (result.inserted) inserted++
          await saveSnapshot(pool, result.id, repo.stars)
        }
        if (repos.length < perPage) break
        await sleep(delayMs)
      }
      await sleep(delayMs)
    }
  } catch (error) {
    await finishIngestRun(pool, runId, { queryCount, reposSeen: seen, reposNew: inserted }, String(error))
    throw error
  }
  await finishIngestRun(pool, runId, { queryCount, reposSeen: seen, reposNew: inserted })
  return { seen, inserted }
}

export async function enrichPendingRepos(pool: DbPool, options: DiscoveryEnrichOptions = {}): Promise<number> {
  const limit = Math.max(1, Math.min(100, options.limit ?? 20))
  const repos = await findPendingRepos(pool, limit, {
    ...(options.topics?.length ? { topics: options.topics } : {}),
  })
  let done = 0
  const queue = [...repos]
  const concurrency = Math.min(3, queue.length)
  const worker = async (): Promise<void> => {
    for (;;) {
      const repo = queue.shift()
      if (!repo) return
      const readme = options.token
        ? await fetchReadme(repo.fullName, options.token).catch(() => null)
        : null
      try {
        const result = await enrichRepo(repo, { llm: options.llm ?? null, readme })
        await updateEnrichment(pool, repo.id, {
          ...result,
          readmeHash: hashReadme(readme),
        })
        done++
      } catch {
        // 单个仓库失败不阻塞整轮采集，下一轮会重新尝试。
      }
      await sleep(150)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  return done
}

export async function runDiscovery(
  pool: DbPool,
  options: {
    topics: string[]
    token?: string | null
    llm?: LlmConfig | null
    pages?: number
    perPage?: number
    enrichLimit?: number
    delayMs?: number
    sort?: 'stars' | 'forks' | 'updated'
    freshDays?: number
    onProgress?: (message: string) => Promise<void> | void
  },
): Promise<DiscoveryRun> {
  await options.onProgress?.('采集候选仓库…')
  const ingest = await ingestRepos(pool, {
    topics: options.topics,
    token: options.token,
    pages: options.pages ?? 1,
    perPage: options.perPage ?? 30,
    delayMs: options.delayMs ?? 1200,
    ...(options.sort ? { sort: options.sort } : {}),
    ...(options.freshDays ? { freshDays: options.freshDays } : {}),
  })
  await options.onProgress?.(`富化 ${options.enrichLimit ?? 20} 个待处理仓库…`)
  const enriched = await enrichPendingRepos(pool, {
    limit: options.enrichLimit ?? 20,
    topics: options.topics,
    token: options.token,
    llm: options.llm,
  })
  await options.onProgress?.('汇总候选池状态…')
  const status = await loadDiscoveryStatus(pool)
  const run: DiscoveryRun = {
    at: new Date().toISOString(),
    topics: options.topics,
    seen: ingest.seen,
    inserted: ingest.inserted,
    enriched,
    pending: status.pendingRepos,
  }
  await saveDiscoveryRun(pool, run)
  return run
}

export async function saveDiscoveryRun(pool: DbPool, run: DiscoveryRun): Promise<void> {
  await pool.query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [LAST_RUN_KEY, JSON.stringify(run)],
  )
}

export async function loadDiscoveryStatus(pool: DbPool): Promise<DiscoveryStatus> {
  const [counts, last] = await Promise.all([
    pool.query<{ total: string; enriched: string; pending: string }>(
      `SELECT count(*) AS total,
         count(*) FILTER (WHERE enriched_at IS NOT NULL) AS enriched,
         count(*) FILTER (WHERE enriched_at IS NULL) AS pending
       FROM repos`,
    ),
    pool.query<{ value: DiscoveryRun }>(`SELECT value FROM app_settings WHERE key = $1`, [LAST_RUN_KEY]),
  ])
  const row = counts.rows[0]
  return {
    totalRepos: Number(row?.total ?? 0),
    enrichedRepos: Number(row?.enriched ?? 0),
    pendingRepos: Number(row?.pending ?? 0),
    lastRun: last.rows[0]?.value ?? null,
  }
}
