import { z } from 'zod'
import type { LlmConfig } from './config.js'
import { findEnrichedRepos, type DbPool } from './db.js'
import { risingRepos, starGrowth } from './rising.js'
import { filterRankingRepos } from './ranking.js'
import { chatCompletion } from './llm.js'
import { extractJsonObjects } from './integrations.js'

export interface TrendRiser {
  fullName: string
  stars: number
  growth: number
  language: string | null
  summary: string | null
  topics: string[]
}

export interface TrendVelocity {
  fullName: string
  stars: number
  ageDays: number
  starsPerDay: number
  createdAt: string
  language: string | null
  summary: string | null
}

export interface TopicMomentum {
  topic: string
  repos: number
  growth: number
  stars: number
}

export interface TrendStats {
  windowDays: number
  totalRepos: number
  risers: TrendRiser[]
  topics: TopicMomentum[]
  newEntrants: TrendRiser[]
  velocity: TrendVelocity[]
}

export const trendBriefSchema = z.object({
  headline: z.string().min(4).max(120),
  points: z
    .array(
      z.object({
        title: z.string().min(2).max(40),
        detail: z.string().min(4).max(220),
        repos: z.array(z.string().min(3).max(120)).max(3).default([]),
      }),
    )
    .min(2)
    .max(5),
  watch: z.array(z.string().min(2).max(160)).max(4).default([]),
})

export type TrendBrief = z.infer<typeof trendBriefSchema>

export interface TrendReport {
  generatedAt: string
  model: string | null
  stats: TrendStats
  brief: TrendBrief
}

const SETTINGS_KEY = 'trends.latest'

/** 纯函数：按 topic 聚合 7 天增速，权重是各仓库增速的平均值。 */
export function aggregateTopicMomentum(
  repos: Array<{ topics: string[]; stars: number; stars7d: number | null }>,
  limit = 8,
): TopicMomentum[] {
  const map = new Map<string, { repos: number; growth: number; stars: number }>()
  for (const repo of repos) {
    const growth = starGrowth({ ...repo, fullName: '' })
    if (growth === null || growth <= 0) continue
    for (const topic of repo.topics) {
      const key = topic.toLowerCase()
      const entry = map.get(key) ?? { repos: 0, growth: 0, stars: 0 }
      entry.repos += 1
      entry.growth += growth
      entry.stars += repo.stars
      map.set(key, entry)
    }
  }
  return [...map.entries()]
    .map(([topic, entry]) => ({
      topic,
      repos: entry.repos,
      growth: Math.round((entry.growth / entry.repos) * 10_000) / 10_000,
      stars: entry.stars,
    }))
    .filter((entry) => entry.repos >= 2)
    .sort((left, right) => right.growth - left.growth)
    .slice(0, Math.max(0, limit))
}

/**
 * 建库以来日均 star 速度，用于覆盖「没有 7 天快照但增长很猛」的新库。
 * 只统计近一年创建、至少 500 star 的仓库。
 */
export function rankVelocity(
  repos: Array<{
    fullName: string
    stars: number
    createdAt: string | null
    language: string | null
    summary: string | null
  }>,
  now = Date.now(),
  limit = 10,
): TrendVelocity[] {
  return repos
    .filter((repo) => repo.createdAt && repo.stars >= 500)
    .map((repo) => {
      const created = Date.parse(repo.createdAt as string)
      const ageDays = Math.max(1, Math.round((now - created) / 86_400_000))
      return {
        fullName: repo.fullName,
        stars: repo.stars,
        ageDays,
        starsPerDay: Math.round((repo.stars / ageDays) * 10) / 10,
        createdAt: repo.createdAt as string,
        language: repo.language,
        summary: repo.summary,
      }
    })
    .filter((entry) => entry.ageDays <= 365)
    .sort((left, right) => right.starsPerDay - left.starsPerDay)
    .slice(0, Math.max(1, limit))
}

export async function computeTrendStats(
  pool: DbPool,
  windowDays = 7,
  options: { includeOfficial?: boolean } = {},
): Promise<TrendStats> {
  const repos = filterRankingRepos(await findEnrichedRepos(pool, 500), options.includeOfficial ?? false)
  const risers: TrendRiser[] = risingRepos(repos, 12).map((repo) => ({
    fullName: repo.fullName,
    stars: repo.stars,
    growth: repo.growth,
    language: repo.language,
    summary: repo.summary,
    topics: repo.topics,
  }))
  const newEntrants: TrendRiser[] = repos
    .filter((repo) => {
      if (!repo.createdAt) return false
      const created = Date.parse(repo.createdAt)
      return Number.isFinite(created) && Date.now() - created < 120 * 24 * 60 * 60 * 1000
    })
    .sort((left, right) => right.stars - left.stars)
    .slice(0, 5)
    .map((repo) => ({
      fullName: repo.fullName,
      stars: repo.stars,
      growth: starGrowth(repo) ?? 0,
      language: repo.language,
      summary: repo.summary,
      topics: repo.topics,
    }))
  return {
    windowDays,
    totalRepos: repos.length,
    risers,
    topics: aggregateTopicMomentum(repos, 8),
    newEntrants,
    velocity: rankVelocity(repos, Date.now(), 10),
  }
}

export function parseTrendBrief(raw: string): TrendBrief {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim()
  let lastError: string | null = null
  for (const candidate of extractJsonObjects(cleaned)) {
    let parsed: unknown
    try {
      parsed = JSON.parse(candidate)
    } catch {
      continue
    }
    const result = trendBriefSchema.safeParse(parsed)
    if (result.success) return result.data
    const issue = result.error.issues[0]
    lastError = `${issue?.path.join('.') ?? 'unknown'} ${issue?.message ?? ''}`
  }
  if (lastError) throw new Error(`趋势简报结构不符合要求：${lastError}`)
  throw new Error('模型返回的趋势简报无法解析')
}

export function fallbackTrendBrief(stats: TrendStats): TrendBrief {
  const top = stats.risers[0]
  const topic = stats.topics[0]
  return {
    headline: top
      ? `本周 ${top.fullName} 涨得最快，${stats.risers.length} 个项目保持增长`
      : '本周没有明显增长的仓库',
    points: [
      ...(top
        ? [
            {
              title: '增长最快',
              detail: `${top.fullName} 近 7 天 star 增长 ${(top.growth * 100).toFixed(1)}%，当前 ${top.stars.toLocaleString('en-US')} stars。`,
              repos: [top.fullName],
            },
          ]
        : []),
      ...(topic
        ? [
            {
              title: `#${topic.topic} 在升温`,
              detail: `${topic.repos} 个相关项目的平均增速是 ${(topic.growth * 100).toFixed(1)}%。`,
              repos: [],
            },
          ]
        : []),
    ].slice(0, 3),
    watch: ['AI 简报尚未生成，先看数据版趋势；配置模型后 worker 会自动补上。'],
  }
}

const BRIEF_PROMPT = `你是开源趋势分析师。根据给定的 7 天 star 增速、topic 动量和项目摘要，写一份中文趋势简报。
规则：
- headline：一句话总结本周趋势（<=40 字）。
- points：3-5 条，每条 title（<=20 字）+ detail（<=120 字，尽量引用数字或仓库名）+ repos（最多 3 个 fullName，只能来自输入）。
- watch：2-3 条值得继续观察的方向或风险。
- 不要编造输入里没有的仓库或数字。
只输出 JSON：
{"headline":"...","points":[{"title":"...","detail":"...","repos":["owner/name"]}],"watch":["..."]}`

export async function generateTrendBrief(stats: TrendStats, llm: LlmConfig): Promise<TrendBrief> {
  const payload = {
    window_days: stats.windowDays,
    total_repos: stats.totalRepos,
    risers: stats.risers.slice(0, 10).map((repo) => ({
      repo: repo.fullName,
      stars: repo.stars,
      growth: repo.growth,
      language: repo.language,
      summary: repo.summary,
      topics: repo.topics.slice(0, 6),
    })),
    topics: stats.topics,
    new_entrants: stats.newEntrants.map((repo) => repo.fullName),
  }
  const prompt = JSON.stringify(payload, null, 2)
  let raw = await chatCompletion(
    llm,
    [
      { role: 'system', content: BRIEF_PROMPT },
      { role: 'user', content: prompt },
    ],
    { temperature: 0.4, maxTokens: 2200, jsonMode: true },
  )
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return parseTrendBrief(raw)
    } catch (error) {
      console.error(`[trends] 第 ${attempt + 1} 次解析失败：`, error, '\n', raw.slice(0, 900))
      if (attempt === 1) break
      raw = await chatCompletion(
        llm,
        [
          { role: 'system', content: BRIEF_PROMPT },
          {
            role: 'user',
            content: `${prompt}\n\n上一次输出不符合要求。请严格输出 JSON，points 3-5 条，repos 只能来自输入。`,
          },
        ],
        { temperature: 0.2, maxTokens: 2500, jsonMode: true },
      )
    }
  }
  return fallbackTrendBrief(stats)
}

export async function buildTrendReport(pool: DbPool, llm: LlmConfig): Promise<TrendReport> {
  const stats = await computeTrendStats(pool)
  const brief = await generateTrendBrief(stats, llm)
  const report: TrendReport = {
    generatedAt: new Date().toISOString(),
    model: llm.model,
    stats,
    brief,
  }
  await saveTrendReport(pool, report)
  return report
}

export async function saveTrendReport(pool: DbPool, report: TrendReport): Promise<void> {
  await pool.query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [SETTINGS_KEY, JSON.stringify(report)],
  )
}

export async function loadTrendReport(pool: DbPool): Promise<TrendReport | null> {
  try {
    const { rows } = await pool.query<{ value: TrendReport }>(
      `SELECT value FROM app_settings WHERE key = $1`,
      [SETTINGS_KEY],
    )
    const value = rows[0]?.value
    if (!value || !value.stats || !value.brief) return null
    // 旧缓存可能没有 velocity 字段，读出来时补齐，避免页面崩溃。
    return {
      ...value,
      stats: {
        ...value.stats,
        topics: value.stats.topics ?? [],
        newEntrants: value.stats.newEntrants ?? [],
        velocity: value.stats.velocity ?? [],
      },
    }
  } catch {
    return null
  }
}
