import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { LlmConfig } from './config.js'
import type { DbPool } from './db.js'
import { extractJsonObjects } from './integrations.js'
import { chatCompletion } from './llm.js'

export const repoProfileSchema = z.object({
  positioning: z.string().min(10).max(240),
  features: z
    .array(
      z.object({
        name: z.string().min(2).max(40),
        detail: z.string().min(4).max(180),
      }),
    )
    .min(3)
    .max(10),
  useCases: z.array(z.string().min(4).max(180)).min(2).max(5),
  notFor: z.array(z.string().min(4).max(180)).max(3).default([]),
  quickstart: z.array(z.string().min(4).max(220)).min(2).max(5),
})

export type RepoProfile = z.infer<typeof repoProfileSchema>

export interface StoredRepoProfile extends RepoProfile {
  repoFullName: string
  sourceHash: string | null
  model: string | null
  generatedAt: string
}

export interface RepoProfileInput {
  repo: string
  description: string
  readme: string | null
  manifestName: string | null
  manifest: string | null
  topics: string[]
  language: string | null
}

const SYSTEM_PROMPT = `你是开源项目分析助手。只根据给定的 README、项目清单和描述，输出结构化的「功能画像」。
规则：
- positioning：一句话说明这个项目是什么、解决什么问题（中文，<=80 字）。
- features：4-8 条具体能力，name 是能力名（<=20 字），detail 说明能力和边界（<=80 字）。
- useCases：3-5 条「适合谁 / 什么场景」。
- notFor：1-3 条「不适合什么场景」，没有依据时可以留空数组。
- quickstart：2-5 条最小上手步骤（安装命令、最小配置、第一个例子）。
- 不要编造 README 里没有的 API；不确定时写得保守。
只输出一个合法 JSON 对象，不要 Markdown 围栏或解释：
{
  "positioning": "...",
  "features": [{ "name": "...", "detail": "..." }],
  "useCases": ["..."],
  "notFor": ["..."],
  "quickstart": ["..."]
}`

function compactInput(input: RepoProfileInput): string {
  return JSON.stringify(
    {
      repo: input.repo,
      description: input.description,
      language: input.language,
      topics: input.topics.slice(0, 12),
      manifest_file: input.manifestName,
      manifest: input.manifest?.slice(0, 3000) ?? null,
      readme: input.readme?.slice(0, 7000) ?? null,
    },
    null,
    2,
  )
}

export function parseRepoProfile(raw: string): RepoProfile {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim()
  let lastError: string | null = null
  for (const candidate of extractJsonObjects(cleaned)) {
    let parsed: unknown
    try {
      parsed = JSON.parse(candidate)
    } catch {
      continue
    }
    const result = repoProfileSchema.safeParse(parsed)
    if (result.success) return result.data
    const issue = result.error.issues[0]
    lastError = `${issue?.path.join('.') ?? 'unknown'} ${issue?.message ?? ''}`
  }
  if (lastError) throw new Error(`功能画像结构不符合要求：${lastError}`)
  throw new Error('模型返回的 JSON 无法解析（可能被截断或混入了说明文字）')
}

export function repoProfileSourceHash(readme: string | null, manifest: string | null): string {
  return createHash('sha256')
    .update(`${readme ?? ''}\u0000${manifest ?? ''}`)
    .digest('hex')
    .slice(0, 24)
}

export async function generateRepoProfile(
  input: RepoProfileInput,
  llm: LlmConfig,
): Promise<RepoProfile> {
  const prompt = compactInput(input)
  const messages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    { role: 'user' as const, content: prompt },
  ]
  let raw = await chatCompletion(llm, messages, { temperature: 0.2, maxTokens: 3000, jsonMode: true })
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return parseRepoProfile(raw)
    } catch (error) {
      console.error(`[repo-profile] 第 ${attempt + 1} 次解析失败：`, error, '\n', raw.slice(0, 900))
      if (attempt === 1) break
      raw = await chatCompletion(
        llm,
        [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `${prompt}\n\n上一次输出不符合要求。请严格输出 JSON，features 4-8 条，每条都要有 name 和 detail。`,
          },
        ],
        { temperature: 0.1, maxTokens: 3500, jsonMode: true },
      )
    }
  }
  throw new Error('模型没有返回合法的功能画像（已自动重试）')
}

export async function saveRepoProfile(
  pool: DbPool,
  repoFullName: string,
  profile: RepoProfile,
  meta: { model?: string | null; sourceHash?: string | null } = {},
): Promise<void> {
  await pool.query(
    `INSERT INTO repo_profiles
       (repo_full_name, positioning, features, use_cases, not_for, quickstart, source_hash, model, generated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
     ON CONFLICT (repo_full_name) DO UPDATE SET
       positioning = EXCLUDED.positioning,
       features = EXCLUDED.features,
       use_cases = EXCLUDED.use_cases,
       not_for = EXCLUDED.not_for,
       quickstart = EXCLUDED.quickstart,
       source_hash = EXCLUDED.source_hash,
       model = EXCLUDED.model,
       generated_at = now()`,
    [
      repoFullName,
      profile.positioning,
      JSON.stringify(profile.features),
      JSON.stringify(profile.useCases),
      JSON.stringify(profile.notFor),
      JSON.stringify(profile.quickstart),
      meta.sourceHash ?? null,
      meta.model ?? null,
    ],
  )
}

export async function loadRepoProfile(
  pool: DbPool,
  repoFullName: string,
): Promise<StoredRepoProfile | null> {
  const { rows } = await pool.query<{
    repo_full_name: string
    positioning: string
    features: RepoProfile['features']
    use_cases: string[]
    not_for: string[]
    quickstart: string[]
    source_hash: string | null
    model: string | null
    generated_at: string
  }>(
    `SELECT repo_full_name, positioning, features, use_cases, not_for, quickstart,
            source_hash, model, generated_at
     FROM repo_profiles WHERE repo_full_name = $1 LIMIT 1`,
    [repoFullName],
  )
  const row = rows[0]
  if (!row) return null
  return {
    repoFullName: row.repo_full_name,
    positioning: row.positioning,
    features: row.features,
    useCases: row.use_cases,
    notFor: row.not_for,
    quickstart: row.quickstart,
    sourceHash: row.source_hash,
    model: row.model,
    generatedAt: row.generated_at,
  }
}

/** 批量加载画像，避免 Top 10 详情页逐条查询。 */
export async function loadRepoProfiles(
  pool: DbPool,
  repoFullNames: string[],
): Promise<Map<string, StoredRepoProfile>> {
  const names = [...new Set(repoFullNames)]
  if (names.length === 0) return new Map()
  const { rows } = await pool.query<{
    repo_full_name: string
    positioning: string
    features: RepoProfile['features']
    use_cases: string[]
    not_for: string[]
    quickstart: string[]
    source_hash: string | null
    model: string | null
    generated_at: string
  }>(
    `SELECT repo_full_name, positioning, features, use_cases, not_for, quickstart,
            source_hash, model, generated_at
     FROM repo_profiles WHERE repo_full_name = ANY($1::text[])`,
    [names],
  )
  const map = new Map<string, StoredRepoProfile>()
  for (const row of rows) {
    map.set(row.repo_full_name, {
      repoFullName: row.repo_full_name,
      positioning: row.positioning,
      features: row.features,
      useCases: row.use_cases,
      notFor: row.not_for,
      quickstart: row.quickstart,
      sourceHash: row.source_hash,
      model: row.model,
      generatedAt: row.generated_at,
    })
  }
  return map
}
