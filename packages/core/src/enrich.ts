import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { LlmConfig } from './config.js'
import { chatCompletion, embedText } from './llm.js'
import type { RepoInput, Verdict } from './types.js'
import { round } from './utils.js'
import { PROMPT_VERSIONS, SCORING_VERSION } from './versions.js'

export const ENRICH_SYSTEM_PROMPT =
  '你是一名资深开源项目评审员。根据给定的仓库信息与 README，判断它是否值得开发者关注。只输出一个 JSON 对象，不要输出任何其他文字。'

export const enrichmentSchema = z.object({
  one_liner: z.string().min(1),
  problem: z.string().default(''),
  audience: z.string().default(''),
  verdict: z.enum(['recommend', 'neutral', 'skip']),
  reason: z.string().default(''),
  quality: z
    .object({
      real_code: z.boolean().default(false),
      docs: z.enum(['good', 'ok', 'poor']).default('ok'),
      tests: z.boolean().default(false),
      ci: z.boolean().default(false),
    })
    .default({ real_code: false, docs: 'ok', tests: false, ci: false }),
})

export type EnrichmentPayload = z.infer<typeof enrichmentSchema>

export interface QualityDetail {
  license: boolean
  recentPush: boolean
  hasDescription: boolean
  hasTopics: boolean
  hasHomepage: boolean
  stars: number
}

export interface EnrichmentResult {
  summary: string
  problem: string
  audience: string
  verdict: Verdict
  reason: string
  qualityScore: number
  qualityDetail: Record<string, unknown>
  embedding: number[] | null
}

export interface EnrichOptions {
  llm: LlmConfig | null
  readme: string | null
  now?: number
}

const VERDICT_SCORE: Record<Verdict, number> = { recommend: 0.9, neutral: 0.5, skip: 0.1 }

export function parseEnrichment(raw: string): EnrichmentPayload | null {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    const parsed = enrichmentSchema.safeParse(JSON.parse(cleaned.slice(start, end + 1)))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function heuristicQuality(repo: RepoInput, now = Date.now()): { score: number; detail: QualityDetail } {
  const days = repo.pushedAt ? (now - Date.parse(repo.pushedAt)) / 86_400_000 : Number.POSITIVE_INFINITY

  let score = 0
  if (repo.license) score += 0.15
  if (days <= 30) score += 0.25
  else if (days <= 90) score += 0.15
  else if (days <= 365) score += 0.05
  if (repo.description && repo.description.length >= 20) score += 0.1
  if (repo.topics.length >= 2) score += 0.1
  if (repo.homepage) score += 0.05
  if (repo.stars >= 100) score += 0.15
  else if (repo.stars >= 20) score += 0.08
  if (!repo.archived) score += 0.1
  if (repo.openIssues > 0) score += 0.05

  return {
    score: round(Math.min(1, score), 2),
    detail: {
      license: Boolean(repo.license),
      recentPush: days <= 90,
      hasDescription: Boolean(repo.description && repo.description.length >= 20),
      hasTopics: repo.topics.length >= 2,
      hasHomepage: Boolean(repo.homepage),
      stars: repo.stars,
    },
  }
}

export function hashReadme(text: string | null): string | null {
  if (!text) return null
  return createHash('sha256').update(text).digest('hex')
}

function verdictFromScore(score: number): Verdict {
  if (score >= 0.6) return 'recommend'
  if (score >= 0.4) return 'neutral'
  return 'skip'
}

function fallbackSummary(repo: RepoInput): string {
  const description = repo.description?.trim()
  return description || `${repo.fullName}（暂无简介）`
}

function fallbackReason(repo: RepoInput, detail: QualityDetail): string {
  const parts: string[] = []
  if (detail.recentPush) parts.push('近期活跃')
  if (detail.license) parts.push('有许可证')
  if (detail.hasTopics) parts.push('主题明确')
  if (repo.stars >= 100) parts.push(`${repo.stars} stars`)
  return parts.length > 0 ? parts.join('，') : '需人工复核'
}

export function buildEnrichmentPrompt(repo: RepoInput, readme: string | null): string {
  return [
    `仓库：${repo.fullName}`,
    `描述：${repo.description ?? '（无）'}`,
    `语言：${repo.language ?? '未知'}；星数：${repo.stars}；主题：${repo.topics.join(', ') || '（无）'}；许可证：${repo.license ?? '无'}；归档：${repo.archived}`,
    '',
    'README（截断）：',
    (readme ?? '（无 README）').slice(0, 8000),
    '',
    '输出 JSON，字段如下：',
    '{"one_liner": "中文一句话说清这是什么（不超过50字）", "problem": "解决的问题", "audience": "适合谁", "verdict": "recommend|neutral|skip", "reason": "推荐或不推荐的原因（不超过60字）", "quality": {"real_code": true/false, "docs": "good|ok|poor", "tests": true/false, "ci": true/false}}',
  ].join('\n')
}

export async function enrichRepo(repo: RepoInput, options: EnrichOptions): Promise<EnrichmentResult> {
  const heuristic = heuristicQuality(repo, options.now)
  let payload: EnrichmentPayload | null = null

  if (options.llm) {
    try {
      const raw = await chatCompletion(options.llm, [
        { role: 'system', content: ENRICH_SYSTEM_PROMPT },
        { role: 'user', content: buildEnrichmentPrompt(repo, options.readme) },
      ])
      payload = parseEnrichment(raw)
    } catch {
      payload = null
    }
  }

  const verdict: Verdict = payload?.verdict ?? verdictFromScore(heuristic.score)
  const qualityScore = payload ? round((heuristic.score + VERDICT_SCORE[verdict]) / 2, 2) : heuristic.score
  const summary = payload?.one_liner ?? fallbackSummary(repo)
  const reason = payload?.reason.trim() || fallbackReason(repo, heuristic.detail)

  let embedding: number[] | null = null
  if (options.llm) {
    const text = [summary, repo.topics.join(' '), repo.description ?? ''].join('\n').slice(0, 4000)
    embedding = await embedText(options.llm, text)
  }

  return {
    summary,
    problem: payload?.problem ?? '',
    audience: payload?.audience ?? '',
    verdict,
    reason,
    qualityScore,
    qualityDetail: {
      ...heuristic.detail,
      llm: payload?.quality ?? null,
      promptVersion: PROMPT_VERSIONS.enrich,
      scoreVersion: SCORING_VERSION,
    },
    embedding,
  }
}
