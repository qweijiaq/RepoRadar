import { z } from 'zod'
import type { LlmConfig } from './config.js'
import type { DbPool } from './db.js'
import { extractJsonObjects } from './integrations.js'
import { chatCompletion } from './llm.js'

export interface WatchCandidate {
  repo: string
  summary: string
  language: string | null
  topics: string[]
  stars: number
}

export const watchMatchSchema = z.object({
  repo: z.string().min(3).max(120),
  score: z.number().int().min(0).max(100),
  reason: z.string().min(4).max(240),
})

export const watchReportSchema = z.object({
  matches: z.array(watchMatchSchema).max(10).default([]),
})

export type WatchMatch = z.infer<typeof watchMatchSchema>
export type WatchReport = z.infer<typeof watchReportSchema>

export interface WatchIntentRecord {
  id: number
  text: string
  active: boolean
  createdAt: string
}

export interface StoredWatchMatch {
  repo: string
  score: number
  reason: string
  createdAt: string
}

const SYSTEM_PROMPT = `你是用户的长期开源项目侦察员。用户会用一句自然语言描述他想关注的项目。
请从候选仓库列表里找出真正符合意图的项目，不要凑数；没有匹配就返回空数组。

规则：
- 只引用候选列表里的仓库全名，不得编造。
- score 0-100：越高越符合用户意图。
- reason 要具体说明匹配了哪些条件，以及可能不符合的地方。
- 最多返回 8 个，按 score 降序。
- 不要因为 stars 高就推荐，意图优先。

只输出一个合法 JSON 对象，不要 Markdown 围栏或解释：
{ "matches": [{ "repo": "owner/name", "score": 88, "reason": "..." }] }`

function compactCandidates(candidates: WatchCandidate[]) {
  return candidates.map((candidate) => ({
    repo: candidate.repo,
    summary: candidate.summary.slice(0, 180),
    language: candidate.language,
    topics: candidate.topics.slice(0, 8),
    stars: candidate.stars,
  }))
}

export function buildWatchPrompt(intent: string, candidates: WatchCandidate[]): string {
  return `我想持续关注：${intent}\n\n候选仓库：\n${JSON.stringify(compactCandidates(candidates), null, 2)}`
}

export function parseWatchReport(raw: string): WatchReport {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim()
  let lastError: string | null = null

  for (const candidate of extractJsonObjects(cleaned)) {
    let parsed: unknown
    try {
      parsed = JSON.parse(candidate)
    } catch {
      continue
    }
    if (typeof parsed !== 'object' || parsed === null) continue
    const matches = (parsed as Record<string, unknown>).matches
    if (!Array.isArray(matches)) continue

    const normalized = {
      matches: matches
        .filter((match) => watchMatchSchema.safeParse(match).success)
        .slice(0, 10),
    }
    const result = watchReportSchema.safeParse(normalized)
    if (result.success) return result.data
    const issue = result.error.issues[0]
    lastError = `${issue?.path.join('.') ?? 'unknown'} ${issue?.message ?? ''}`
  }

  if (lastError) throw new Error(`订阅代理结果结构不符合要求：${lastError}`)
  throw new Error('模型返回的 JSON 无法解析（可能被截断或混入了说明文字）')
}

export function groundWatchReport(report: WatchReport, candidates: WatchCandidate[]): WatchReport {
  const names = new Set(candidates.map((candidate) => candidate.repo.toLowerCase()))
  const seen = new Set<string>()
  return {
    matches: report.matches.filter((match) => {
      const key = match.repo.toLowerCase()
      if (!names.has(key) || seen.has(key)) return false
      seen.add(key)
      return true
    }),
  }
}

export async function generateWatchMatches(
  intent: string,
  candidates: WatchCandidate[],
  llm: LlmConfig,
): Promise<WatchMatch[]> {
  const prompt = buildWatchPrompt(intent, candidates)
  const messages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    { role: 'user' as const, content: prompt },
  ]

  let raw = await chatCompletion(llm, messages, { temperature: 0.3, maxTokens: 3000, jsonMode: true })
  let report: WatchReport | null = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      report = parseWatchReport(raw)
      break
    } catch (error) {
      console.error(`[watch] 第 ${attempt + 1} 次输出解析失败：`, error, '\n', raw.slice(0, 800))
      if (attempt === 1) break
      raw = await chatCompletion(
        llm,
        [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `${prompt}\n\n上一次输出不是合法 JSON。只输出 {"matches":[]} 结构。` },
        ],
        { temperature: 0.2, maxTokens: 3000, jsonMode: true },
      )
    }
  }
  if (!report) throw new Error('模型没有返回合法 JSON（已自动重试）')
  return groundWatchReport(report, candidates).matches
}

export async function createWatchIntent(
  pool: DbPool,
  userId: number,
  text: string,
): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO watch_intents (user_id, text) VALUES ($1, $2) RETURNING id`,
    [userId, text],
  )
  return Number(rows[0]?.id ?? 0)
}

export async function deleteWatchIntent(pool: DbPool, userId: number, id: number): Promise<void> {
  await pool.query(`DELETE FROM watch_intents WHERE id = $1 AND user_id = $2`, [id, userId])
}

export async function listWatchIntents(pool: DbPool, userId: number): Promise<WatchIntentRecord[]> {
  const { rows } = await pool.query<{
    id: string
    text: string
    active: boolean
    created_at: Date | string
  }>(
    `SELECT id, text, active, created_at FROM watch_intents
     WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  )
  return rows.map((row) => ({
    id: Number(row.id),
    text: row.text,
    active: row.active,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  }))
}

export async function findWatchIntent(
  pool: DbPool,
  userId: number,
  id: number,
): Promise<WatchIntentRecord | null> {
  const { rows } = await pool.query<{
    id: string
    text: string
    active: boolean
    created_at: Date | string
  }>(
    `SELECT id, text, active, created_at FROM watch_intents WHERE id = $1 AND user_id = $2`,
    [id, userId],
  )
  const row = rows[0]
  if (!row) return null
  return {
    id: Number(row.id),
    text: row.text,
    active: row.active,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  }
}

export async function saveWatchMatches(
  pool: DbPool,
  intentId: number,
  matches: WatchMatch[],
): Promise<void> {
  for (const match of matches) {
    await pool.query(
      `INSERT INTO watch_matches (intent_id, repo_full_name, score, reason)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (intent_id, repo_full_name) DO UPDATE SET
         score = EXCLUDED.score,
         reason = EXCLUDED.reason,
         created_at = now()`,
      [intentId, match.repo, match.score, match.reason],
    )
  }
}

export async function listWatchMatches(
  pool: DbPool,
  intentId: number,
  limit = 10,
): Promise<StoredWatchMatch[]> {
  const { rows } = await pool.query<{
    repo_full_name: string
    score: number
    reason: string
    created_at: Date | string
  }>(
    `SELECT repo_full_name, score, reason, created_at
     FROM watch_matches WHERE intent_id = $1
     ORDER BY score DESC, created_at DESC LIMIT $2`,
    [intentId, limit],
  )
  return rows.map((row) => ({
    repo: row.repo_full_name,
    score: row.score,
    reason: row.reason,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  }))
}

export async function saveWatchRun(
  pool: DbPool,
  intentId: number,
  input: { model: string; providerId: string | null; matchCount: number },
): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO watch_runs (intent_id, model, provider_id, match_count)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [intentId, input.model, input.providerId, input.matchCount],
  )
  return Number(rows[0]?.id ?? 0)
}
