import { z } from 'zod'
import type { LlmConfig } from './config.js'
import type { DbPool } from './db.js'
import { extractJsonObjects } from './integrations.js'
import { chatCompletion } from './llm.js'
import { isTeamRole, type TeamRole } from './teams.js'

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

export type WatchAccess = 'owner' | 'write' | 'read'

export interface WatchIntentRecord {
  id: number
  text: string
  active: boolean
  teamId: number | null
  teamName: string | null
  teamRole: TeamRole | null
  access: WatchAccess
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
- 最多返回 10 个，按 score 降序。
- 不要因为 stars 高就推荐，意图优先。
- 不要输出分析、推理、思考过程或候选点评；第一个字符必须是 {，最后一个字符必须是 }。

只输出一个合法 JSON 对象，不要 Markdown 围栏或解释：
{ "matches": [{ "repo": "owner/name", "score": 88, "reason": "..." }] }`

function compactCandidates(candidates: WatchCandidate[]) {
  return candidates.map((candidate) => ({
    repo: candidate.repo,
    summary: candidate.summary.slice(0, 120),
    language: candidate.language,
    topics: candidate.topics.slice(0, 5),
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

const QUERY_PROMPT = `你是 GitHub 搜索助手。把用户的关注描述转成 2-3 条适合 GitHub 仓库搜索的英文关键词查询。
规则：
- 每条只包含 2-5 个英文关键词，不要包含 stars/pushed/topic 等操作符，不要引号。
- 覆盖不同表达：能力名、技术栈、使用场景。
- 如果描述本身是中文，也翻译成常见的英文开源术语。
只输出一个合法 JSON 对象：{"queries":["...","..."]}`

export async function deriveWatchSearchQueries(intent: string, llm: LlmConfig): Promise<string[]> {
  try {
    const raw = await chatCompletion(
      llm,
      [
        { role: 'system', content: QUERY_PROMPT },
        { role: 'user', content: intent },
      ],
      { temperature: 0.2, maxTokens: 240, jsonMode: true },
    )
    const cleaned = raw.replace(/```(?:json)?/gi, '').trim()
    for (const candidate of extractJsonObjects(cleaned)) {
      try {
        const parsed = JSON.parse(candidate) as { queries?: unknown }
        if (!Array.isArray(parsed.queries)) continue
        const queries = parsed.queries
          .filter((query): query is string => typeof query === 'string')
          .map((query) => query.replace(/["\r\n]/g, ' ').trim())
          .filter((query) => query.length >= 2 && query.length <= 80)
          .slice(0, 3)
        if (queries.length > 0) return queries
      } catch {
        // 尝试下一个 JSON 对象
      }
    }
  } catch {
    // 关键词提取失败时只使用本地候选池
  }
  return []
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'project', 'projects', 'open',
  'source', 'written', 'using', 'want', 'looking', 'follow', 'track', 'about', 'into',
  'app', 'apps', 'tool', 'tools', 'library', 'libraries', 'framework', 'frameworks',
])

function intentTokens(intent: string): string[] {
  const lower = intent.toLowerCase()
  const tokens = new Set<string>()
  for (const token of lower.match(/[a-z0-9][a-z0-9.+#_-]{1,}/g) ?? []) {
    if (token.length >= 2 && !STOP_WORDS.has(token)) tokens.add(token)
  }
  for (const run of intent.match(/[\u3400-\u9fff]{2,}/g) ?? []) {
    for (let index = 0; index < run.length - 1; index++) {
      const bigram = run.slice(index, index + 2)
      if (!['项目', '一个', '可以', '支持', '的是', '写的', '想要', '关注'].includes(bigram)) {
        tokens.add(bigram)
      }
    }
  }
  return [...tokens]
}

function scoreCandidate(
  intent: string,
  candidate: WatchCandidate,
): { score: number; semanticScore: number; matched: string[] } {
  const tokens = intentTokens(intent)
  const haystack = [candidate.repo, candidate.summary, ...candidate.topics].join(' ').toLowerCase()
  const matched: string[] = []
  let score = 0
  for (const token of tokens) {
    if (!haystack.includes(token)) continue
    matched.push(token)
    score += token.length >= 4 ? 3 : 1
  }
  const semanticScore = score
  if (candidate.language && intent.toLowerCase().includes(candidate.language.toLowerCase())) {
    score += 5
    matched.push(candidate.language)
  }
  return { score, semanticScore, matched: [...new Set(matched)] }
}

/** 模型输出无法解析时的确定性兜底：按意图关键词和语言做简单匹配。 */
export function fallbackWatchMatches(
  intent: string,
  candidates: WatchCandidate[],
  limit = 5,
): WatchMatch[] {
  return candidates
    .map((candidate) => ({ candidate, ...scoreCandidate(intent, candidate) }))
    .filter((item) => item.semanticScore >= 2)
    .sort((left, right) => right.score - left.score || right.candidate.stars - left.candidate.stars)
    .slice(0, limit)
    .map((item) => ({
      repo: item.candidate.repo,
      score: Math.min(92, 45 + item.score * 5),
      reason: `关键词匹配（模型输出格式异常时的回退）：命中 ${item.matched.slice(0, 5).join('、') || '项目信息'}。建议稍后重跑以获取模型判断。`,
    }))
}

function prioritizeCandidates(intent: string, candidates: WatchCandidate[], limit: number): WatchCandidate[] {
  return candidates
    .map((candidate) => ({ candidate, score: scoreCandidate(intent, candidate).score }))
    .sort((left, right) => right.score - left.score || right.candidate.stars - left.candidate.stars)
    .slice(0, limit)
    .map((item) => item.candidate)
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

  let raw = await chatCompletion(llm, messages, { temperature: 0.25, maxTokens: 7000, jsonMode: true })
  let report: WatchReport | null = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      report = parseWatchReport(raw)
      break
    } catch (error) {
      console.error(`[watch] 第 ${attempt + 1} 次输出解析失败：`, error, '\n', raw.slice(0, 800))
      if (attempt === 1) break
      const compact = prioritizeCandidates(intent, candidates, 60)
      raw = await chatCompletion(
        llm,
        [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `${buildWatchPrompt(intent, compact)}\n\n上一次输出不是合法 JSON，且包含了分析过程。不要解释、不要点评、不要写思考过程，直接输出 {"matches":[{"repo":"owner/name","score":80,"reason":"..."}]} 结构。`,
          },
        ],
        { temperature: 0.15, maxTokens: 5000, jsonMode: true },
      )
    }
  }
  if (!report) {
    const fallback = fallbackWatchMatches(intent, candidates, 5)
    if (fallback.length > 0) {
      console.warn(`[watch] 模型连续两次返回非法 JSON，使用关键词兜底 ${fallback.length} 条`)
      return fallback
    }
    throw new Error('模型没有返回合法 JSON（已自动重试）')
  }
  return groundWatchReport(report, candidates).matches
}

export async function createWatchIntent(
  pool: DbPool,
  userId: number,
  text: string,
  teamId: number | null = null,
): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO watch_intents (user_id, text, team_id) VALUES ($1, $2, $3) RETURNING id`,
    [userId, text, teamId],
  )
  return Number(rows[0]?.id ?? 0)
}

/** 个人意图本人可删；团队意图需要 owner/admin/member。 */
export async function deleteWatchIntent(pool: DbPool, userId: number, id: number): Promise<void> {
  await pool.query(
    `DELETE FROM watch_intents wi
     WHERE wi.id = $1
       AND (
         wi.user_id = $2
         OR EXISTS (
           SELECT 1 FROM team_members tm
           WHERE tm.team_id = wi.team_id AND tm.user_id = $2 AND tm.role <> 'viewer'
         )
       )`,
    [id, userId],
  )
}

interface WatchIntentRow {
  id: string
  text: string
  active: boolean
  team_id: string | null
  team_name?: string | null
  team_role?: string | null
  created_at: Date | string
}

const WATCH_INTENT_SELECT = `SELECT wi.id, wi.text, wi.active, wi.team_id, wi.created_at,
  t.name AS team_name, tm.role AS team_role
  FROM watch_intents wi
  LEFT JOIN teams t ON t.id = wi.team_id
  LEFT JOIN team_members tm ON tm.team_id = wi.team_id AND tm.user_id = $1`

function mapWatchIntent(row: WatchIntentRow, _userId: number): WatchIntentRecord {
  const teamRole = row.team_role && isTeamRole(row.team_role) ? row.team_role : null
  const access: WatchAccess =
    Number(row.id) > 0 && teamRole === null && row.team_id === null
      ? 'owner'
      : teamRole === 'viewer'
        ? 'read'
        : teamRole
          ? 'write'
          : 'read'
  return {
    id: Number(row.id),
    text: row.text,
    active: row.active,
    teamId: row.team_id ? Number(row.team_id) : null,
    teamName: row.team_name ?? null,
    teamRole,
    access,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  }
}

export async function listWatchIntents(pool: DbPool, userId: number): Promise<WatchIntentRecord[]> {
  const { rows } = await pool.query<WatchIntentRow>(
    `${WATCH_INTENT_SELECT}
     WHERE wi.user_id = $1 OR tm.user_id IS NOT NULL
     ORDER BY wi.created_at DESC`,
    [userId],
  )
  return rows.map((row) => mapWatchIntent(row, userId))
}

export async function findWatchIntent(
  pool: DbPool,
  userId: number,
  id: number,
): Promise<WatchIntentRecord | null> {
  const { rows } = await pool.query<WatchIntentRow>(
    `${WATCH_INTENT_SELECT}
     WHERE wi.id = $2 AND (wi.user_id = $1 OR tm.user_id IS NOT NULL)
     LIMIT 1`,
    [userId, id],
  )
  const row = rows[0]
  return row ? mapWatchIntent(row, userId) : null
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
  input: { model: string; providerId: string | null; promptVersion?: string | null; matchCount: number },
): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO watch_runs (intent_id, model, provider_id, prompt_version, match_count)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [intentId, input.model, input.providerId, input.promptVersion ?? null, input.matchCount],
  )
  return Number(rows[0]?.id ?? 0)
}
