import { z } from 'zod'
import type { LlmConfig } from './config.js'
import type { DbPool } from './db.js'
import { extractJsonObjects } from './integrations.js'
import { chatCompletion } from './llm.js'

export interface TrendingItem {
  fullName: string
  stars: number
  stars7d: number
  gain: number
  growth: number
  language: string | null
  summary: string | null
  topics: string[]
}

export const trendingCopySchema = z.object({
  headline: z.string().min(4).max(40),
  intro: z.string().min(4).max(120),
  lines: z.record(z.string(), z.string().min(2).max(80)),
  hashtags: z.array(z.string().min(1).max(20)).min(2).max(6),
})

export type TrendingCopy = z.infer<typeof trendingCopySchema>

export interface TrendingDetail {
  fullName: string
  positioning: string
  features: Array<{ name: string; detail: string }>
  useCases: string[]
  quickstart: string[]
  stars: number
  gain: number
  growth: number
  language: string | null
  topics: string[]
  hasProfile: boolean
}

export interface TrendingVelocity {
  fullName: string
  stars: number
  starsPerDay: number
  createdAt: string
}

export interface TrendingPost {
  dateKey: string
  dateLabel: string
  generatedAt: string | null
  model: string | null
  items: TrendingItem[]
  velocity: TrendingVelocity[]
  copy: TrendingCopy
}

/** 上海时区的日期 key（YYYY-MM-DD），用于缓存分享卡。 */
export function trendingDateKey(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  return parts
}

export function trendingDateLabel(now = new Date()): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'long',
    day: 'numeric',
  }).format(now)
}

/** 按 7 天 star 绝对增量排序，只保留有快照且正增长的项目。 */
export function selectTrendingItems(
  repos: Array<{
    fullName: string
    stars: number
    stars7d: number | null
    language: string | null
    summary: string | null
    topics: string[]
  }>,
  limit = 10,
): TrendingItem[] {
  return repos
    .filter((repo) => repo.stars7d !== null && repo.stars7d > 0 && repo.stars > repo.stars7d)
    .map((repo) => ({
      fullName: repo.fullName,
      stars: repo.stars,
      stars7d: repo.stars7d as number,
      gain: repo.stars - (repo.stars7d as number),
      growth: Math.round(((repo.stars - (repo.stars7d as number)) / (repo.stars7d as number)) * 10_000) / 10_000,
      language: repo.language,
      summary: repo.summary,
      topics: repo.topics,
    }))
    .sort((left, right) => right.gain - left.gain || right.growth - left.growth)
    .slice(0, Math.max(1, limit))
}

export function toTrendingDetail(
  item: TrendingItem,
  profile: {
    positioning: string
    features: Array<{ name: string; detail: string }>
    useCases: string[]
    quickstart: string[]
  } | null,
): TrendingDetail {
  const topics = item.topics.slice(0, 4)
  return {
    fullName: item.fullName,
    positioning: profile?.positioning ?? item.summary ?? '暂无简介',
    features:
      profile?.features.slice(0, 4) ??
      topics.map((topic) => ({ name: `#${topic}`, detail: '相关主题' })),
    useCases: profile?.useCases.slice(0, 2) ?? [],
    quickstart: profile?.quickstart.slice(0, 2) ?? [],
    stars: item.stars,
    gain: item.gain,
    growth: item.growth,
    language: item.language,
    topics,
    hasProfile: Boolean(profile),
  }
}

export function templateTrendingCopy(items: TrendingItem[]): TrendingCopy {
  const top = items[0]
  return {
    headline: top ? `GitHub 飙升榜｜${top.fullName} 本周断层第一` : 'GitHub 飙升榜｜本周暂无数据',
    intro: `近 7 天 star 增量 Top ${items.length}，数据来自 RepoRadar 的每日快照。`,
    lines: Object.fromEntries(
      items.map((item) => [
        item.fullName,
        `${item.summary?.slice(0, 46) ?? `${item.language ?? '开源'} 项目`}（+${formatGain(item.gain)} stars）`,
      ]),
    ),
    hashtags: ['GitHub', '开源', 'AI', '独立开发'],
  }
}

export function formatGain(gain: number): string {
  if (gain >= 10_000) return `${(gain / 1000).toFixed(1)}k`
  if (gain >= 1000) return `${(gain / 1000).toFixed(1)}k`
  return String(gain)
}

export function buildTrendingText(post: TrendingPost, details: TrendingDetail[] = []): string {
  const lines = post.items.map(
    (item, index) =>
      `${index + 1}. ${item.fullName} — +${item.gain.toLocaleString('en-US')} stars（+${(item.growth * 100).toFixed(1)}%）\n   ${post.copy.lines[item.fullName] ?? item.summary ?? ''}`,
  )
  return [
    `${post.copy.headline}`,
    '',
    post.copy.intro,
    '',
    ...lines,
    '',
    ...(details.length > 0
      ? [
          '详细看点',
          ...details.map((detail) => {
            const capabilities = detail.features
              .slice(0, 3)
              .map((feature) => feature.name)
              .join('、')
            return `· ${detail.fullName}：${detail.positioning}${capabilities ? `\n  能力：${capabilities}` : ''}`
          }),
          '',
        ]
      : []),
    ...(post.velocity.length > 0
      ? [
          '新库速度榜（建库以来日均 star）',
          ...post.velocity.map(
            (item, index) =>
              `${index + 1}. ${item.fullName} — ${item.starsPerDay.toLocaleString('en-US')}/天 · ${item.stars.toLocaleString('en-US')} stars`,
          ),
          '',
        ]
      : []),
    `数据来自 RepoRadar · ${post.dateLabel}`,
    post.copy.hashtags.map((tag) => `#${tag}`).join(' '),
  ].join('\n')
}

export function parseTrendingCopy(raw: string, items: TrendingItem[]): TrendingCopy {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim()
  let lastError: string | null = null
  for (const candidate of extractJsonObjects(cleaned)) {
    let parsed: unknown
    try {
      parsed = JSON.parse(candidate)
    } catch {
      continue
    }
    const result = trendingCopySchema.safeParse(parsed)
    if (!result.success) {
      const issue = result.error.issues[0]
      lastError = `${issue?.path.join('.') ?? 'unknown'} ${issue?.message ?? ''}`
      continue
    }
    const allowed = new Set(items.map((item) => item.fullName))
    const lines: Record<string, string> = {}
    for (const [repo, line] of Object.entries(result.data.lines)) {
      if (allowed.has(repo)) lines[repo] = line.slice(0, 80)
    }
    return { ...result.data, lines }
  }
  if (lastError) throw new Error(`分享文案结构不符合要求：${lastError}`)
  throw new Error('模型返回的分享文案无法解析')
}

const COPY_PROMPT = `你是开源趋势编辑，写一条小红书风格的「GitHub 飙升榜」。
规则：
- headline：<=20 字，有冲击力但不夸大，最多 1 个 emoji。
- intro：<=60 字，概括这一期看点。
- lines：给每个仓库写一句 <=40 字的介绍，只能引用给定数字/摘要，不能编造功能。
- hashtags：3-5 个，不要带 # 号。
只输出 JSON：
{"headline":"...","intro":"...","lines":{"owner/name":"..."},"hashtags":["GitHub","开源"]}`

export async function generateTrendingCopy(
  items: TrendingItem[],
  llm: LlmConfig,
): Promise<TrendingCopy> {
  const payload = items.map((item) => ({
    repo: item.fullName,
    stars: item.stars,
    gain: item.gain,
    growth: item.growth,
    language: item.language,
    summary: item.summary,
  }))
  const prompt = JSON.stringify(payload, null, 2)
  let raw = await chatCompletion(
    llm,
    [
      { role: 'system', content: COPY_PROMPT },
      { role: 'user', content: prompt },
    ],
    { temperature: 0.6, maxTokens: 1600, jsonMode: true },
  )
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return parseTrendingCopy(raw, items)
    } catch (error) {
      console.error(`[trending] 第 ${attempt + 1} 次解析失败：`, error, '\n', raw.slice(0, 800))
      if (attempt === 1) break
      raw = await chatCompletion(
        llm,
        [
          { role: 'system', content: COPY_PROMPT },
          {
            role: 'user',
            content: `${prompt}\n\n上一次输出不符合要求。请严格输出 JSON，lines 的 key 必须是给定 repo。`,
          },
        ],
        { temperature: 0.3, maxTokens: 1800, jsonMode: true },
      )
    }
  }
  return templateTrendingCopy(items)
}

export async function saveTrendingCopy(
  pool: DbPool,
  dateKey: string,
  copy: TrendingCopy,
  meta: { model: string | null; generatedAt: string },
  kind: 'post' | 'daily' = 'post',
): Promise<void> {
  await pool.query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [`trending.${kind}.${dateKey}`, JSON.stringify({ copy, ...meta })],
  )
}

export async function loadTrendingCopy(
  pool: DbPool,
  dateKey: string,
  kind: 'post' | 'daily' = 'post',
): Promise<{ copy: TrendingCopy; model: string | null; generatedAt: string } | null> {
  try {
    const { rows } = await pool.query<{
      value: { copy: TrendingCopy; model: string | null; generatedAt: string }
    }>(`SELECT value FROM app_settings WHERE key = $1`, [`trending.${kind}.${dateKey}`])
    const value = rows[0]?.value
    if (!value?.copy) return null
    return value
  } catch {
    return null
  }
}
