import { z } from 'zod'
import type { LlmConfig } from './config.js'
import { searchEnrichedRepos, searchEnrichedReposByEmbedding, type DbPool } from './db.js'
import type { EnrichedRepoRecord } from './types.js'
import { extractJsonObjects } from './integrations.js'
import { chatCompletion, embedText } from './llm.js'

export const searchIntentSchema = z.object({
  keywords: z.array(z.string().min(1).max(40)).min(1).max(6),
  language: z.string().max(40).nullable().default(null),
  topics: z.array(z.string().max(40)).max(4).default([]),
  minStars: z.number().int().min(0).max(1_000_000).default(0),
  mustHave: z.array(z.string().max(60)).max(5).default([]),
  avoid: z.array(z.string().max(60)).max(5).default([]),
  summary: z.string().max(200).default(''),
})

export type SearchIntent = z.infer<typeof searchIntentSchema>

export interface IntentSearchHit {
  repo: EnrichedRepoRecord
  fit: number
  why: string
  gaps: string
}

export interface IntentSearchResult {
  intent: SearchIntent
  answer: string
  results: IntentSearchHit[]
  cached: boolean
}

const INTENT_PROMPT = `你是开源项目搜索助手。把用户的一句话需求解析成结构化查询。
规则：
- keywords：2-5 个用于检索的关键词/同义词（中英文都可以，尽量是仓库名/摘要里会出现的词）。
- language：用户明确要求的语言，否则 null。
- topics：最多 3 个 GitHub topic 风格标签。
- minStars：用户对热度的最低要求，没有就 0。
- mustHave：必须满足的能力（例如「支持 Postgres」「有 CLI」），最多 3 条。
- avoid：要排除的东西（例如「不要商业版」「不要 Java」），最多 3 条。
- summary：一句话复述你理解的需求。
只输出 JSON：
{"keywords":["..."],"language":null,"topics":[],"minStars":0,"mustHave":[],"avoid":[],"summary":"..."}`

const RERANK_PROMPT = `你是仓库搜索助手。根据用户需求和候选仓库，选出最匹配的结果。
规则：
- 只能从候选里选，repo 必须原样使用候选的 fullName。
- 按匹配度从高到低，最多返回 required 个。
- why 要引用候选的摘要/主题/语言，说明为什么匹配。
- gaps 说明候选缺什么或有什么风险；没有明显问题就写「无明显缺口」。
- 如果所有候选都不合适，answer 说明原因，results 返回空数组。
只输出 JSON：
{"answer":"一句话结论","results":[{"repo":"owner/name","fit":0,"why":"...","gaps":"..."}]}`

export function parseIntentQuery(raw: string): SearchIntent {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim()
  let lastError: string | null = null
  for (const candidate of extractJsonObjects(cleaned)) {
    let parsed: unknown
    try {
      parsed = JSON.parse(candidate)
    } catch {
      continue
    }
    const result = searchIntentSchema.safeParse(parsed)
    if (result.success) return result.data
    const issue = result.error.issues[0]
    lastError = `${issue?.path.join('.') ?? 'unknown'} ${issue?.message ?? ''}`
  }
  if (lastError) throw new Error(`搜索意图结构不符合要求：${lastError}`)
  throw new Error('模型返回的搜索意图无法解析')
}

export function parseRerankResult(
  raw: string,
  candidates: EnrichedRepoRecord[],
  limit: number,
): { answer: string; results: IntentSearchHit[] } {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim()
  const byName = new Map(candidates.map((repo) => [repo.fullName.toLowerCase(), repo]))
  for (const candidate of extractJsonObjects(cleaned)) {
    let parsed: unknown
    try {
      parsed = JSON.parse(candidate)
    } catch {
      continue
    }
    if (!parsed || typeof parsed !== 'object') continue
    const data = parsed as { answer?: unknown; results?: unknown }
    if (!Array.isArray(data.results)) continue
    const results: IntentSearchHit[] = []
    for (const item of data.results) {
      if (!item || typeof item !== 'object') continue
      const row = item as { repo?: unknown; fit?: unknown; why?: unknown; gaps?: unknown }
      const repo = typeof row.repo === 'string' ? byName.get(row.repo.toLowerCase()) : undefined
      if (!repo) continue
      results.push({
        repo,
        fit: Math.max(0, Math.min(100, Number(row.fit) || 0)),
        why: String(row.why ?? '').slice(0, 300),
        gaps: String(row.gaps ?? '').slice(0, 300),
      })
      if (results.length >= limit) break
    }
    return { answer: String(data.answer ?? '').slice(0, 400), results }
  }
  throw new Error('模型返回的搜索结果无法解析')
}

async function parseIntent(query: string, llm: LlmConfig): Promise<SearchIntent> {
  const raw = await chatCompletion(
    llm,
    [
      { role: 'system', content: INTENT_PROMPT },
      { role: 'user', content: query },
    ],
    { temperature: 0.2, maxTokens: 800, jsonMode: true },
  )
  return parseIntentQuery(raw)
}

function matchesAvoid(repo: EnrichedRepoRecord, avoid: string[]): boolean {
  if (avoid.length === 0) return false
  const haystack = `${repo.fullName} ${repo.summary ?? ''} ${repo.topics.join(' ')}`.toLowerCase()
  return avoid.some((word) => haystack.includes(word.toLowerCase()))
}

/** 纯函数：按意图过滤候选（语言 / star / topic / 排除项）。 */
export function filterIntentCandidates(
  repos: EnrichedRepoRecord[],
  intent: SearchIntent,
): EnrichedRepoRecord[] {
  const language = intent.language?.toLowerCase() ?? null
  const topics = intent.topics.map((topic) => topic.toLowerCase())
  return repos.filter((repo) => {
    if (language && (repo.language ?? '').toLowerCase() !== language) return false
    if (intent.minStars > 0 && repo.stars < intent.minStars) return false
    if (topics.length > 0 && !repo.topics.some((topic) => topics.includes(topic.toLowerCase()))) {
      return false
    }
    if (matchesAvoid(repo, intent.avoid)) return false
    return true
  })
}

const cache = new Map<string, { expires: number; value: IntentSearchResult }>()
const CACHE_TTL = 10 * 60 * 1000

export function clearIntentCache(): void {
  cache.clear()
}

/**
 * 意图搜索：LLM 解析需求 → 关键词 + 向量混合召回 → LLM 重排。
 * 任何一步失败都尽量降级到「关键词 + 质量分」的结果。
 */
export async function searchByIntent(
  pool: DbPool,
  llm: LlmConfig,
  query: string,
  options: { limit?: number } = {},
): Promise<IntentSearchResult> {
  const normalized = query.trim().slice(0, 300)
  const limit = Math.max(1, Math.min(10, options.limit ?? 6))
  const key = `${normalized}|${limit}`
  const cached = cache.get(key)
  if (cached && cached.expires > Date.now()) return { ...cached.value, cached: true }

  let intent: SearchIntent
  try {
    intent = await parseIntent(normalized, llm)
  } catch (error) {
    console.error('[intent-search] 意图解析失败，降级为关键词：', error)
    intent = {
      keywords: [normalized.slice(0, 40)],
      language: null,
      topics: [],
      minStars: 0,
      mustHave: [],
      avoid: [],
      summary: '',
    }
  }

  const collected = new Map<string, EnrichedRepoRecord>()
  await Promise.all(
    intent.keywords.map(async (keyword) => {
      const repos = await searchEnrichedRepos(pool, { query: keyword, language: intent.language ?? undefined, limit: 15 })
      for (const repo of repos) collected.set(repo.fullName.toLowerCase(), repo)
    }),
  )

  const embedding = await embedText(llm, normalized).catch(() => null)
  if (embedding) {
    try {
      const semantic = await searchEnrichedReposByEmbedding(pool, embedding, 30)
      for (const repo of semantic) {
        if (!collected.has(repo.fullName.toLowerCase())) collected.set(repo.fullName.toLowerCase(), repo)
      }
    } catch (error) {
      console.error('[intent-search] 向量检索失败：', error)
    }
  }

  let candidates = filterIntentCandidates([...collected.values()], intent)
  candidates = candidates
    .sort((left, right) => (right.qualityScore ?? 0) - (left.qualityScore ?? 0) || right.stars - left.stars)
    .slice(0, 12)

  if (candidates.length === 0) {
    const fallback = await searchEnrichedRepos(pool, { query: intent.keywords[0], limit: 10 })
    candidates = fallback.slice(0, 12)
  }

  if (candidates.length === 0) {
    const empty: IntentSearchResult = {
      intent,
      answer: '没有找到匹配的仓库，可以换一个说法或放宽语言/热度限制。',
      results: [],
      cached: false,
    }
    cache.set(key, { expires: Date.now() + CACHE_TTL, value: empty })
    return empty
  }

  try {
    const raw = await chatCompletion(
      llm,
      [
        { role: 'system', content: RERANK_PROMPT },
        {
          role: 'user',
          content: JSON.stringify(
            {
              query: normalized,
              intent,
              required: limit,
              candidates: candidates.map((repo) => ({
                fullName: repo.fullName,
                summary: repo.summary,
                language: repo.language,
                stars: repo.stars,
                topics: repo.topics.slice(0, 8),
              })),
            },
            null,
            2,
          ),
        },
      ],
      { temperature: 0.2, maxTokens: 2500, jsonMode: true },
    )
    const reranked = parseRerankResult(raw, candidates, limit)
    const result: IntentSearchResult = { intent, answer: reranked.answer, results: reranked.results, cached: false }
    cache.set(key, { expires: Date.now() + CACHE_TTL, value: result })
    return result
  } catch (error) {
    console.error('[intent-search] 重排失败，返回召回结果：', error)
    const result: IntentSearchResult = {
      intent,
      answer: '按关键词和语义相似度排序；重排模型暂时不可用。',
      results: candidates.slice(0, limit).map((repo) => ({
        repo,
        fit: Math.round((repo.qualityScore ?? 0.5) * 100),
        why: repo.summary ?? repo.description ?? '与查询关键词匹配',
        gaps: '未做 AI 重排，建议点进仓库确认',
      })),
      cached: false,
    }
    cache.set(key, { expires: Date.now() + CACHE_TTL, value: result })
    return result
  }
}
