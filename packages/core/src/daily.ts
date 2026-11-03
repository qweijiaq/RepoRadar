import type { DbPool } from './db.js'
import { filterRankingRepos } from './ranking.js'
import { trendingDateKey, trendingDateLabel, type TrendingCopy, type TrendingItem } from './trending.js'

export interface DailyRankingItem extends TrendingItem {
  previousStars: number
  previousDate: string
}

export interface DailyRanking {
  dateKey: string
  dateLabel: string
  /** day：上一次快照就是昨天；multi-day：快照间隔超过一天 */
  basis: 'day' | 'multi-day'
  previousDate: string | null
  items: DailyRankingItem[]
  /** 是否来自 daily_rankings 持久化表 */
  persisted?: boolean
}

export interface DailyRankingOptions {
  includeOfficial?: boolean
}

/** 记录所有已富化仓库的今日快照；已有当天快照时更新为当前 star。 */
export async function recordDailySnapshots(pool: DbPool): Promise<number> {
  const { rowCount } = await pool.query(
    `INSERT INTO star_snapshots (repo_id, captured_on, stars)
     SELECT id, CURRENT_DATE, stars FROM repos WHERE enriched_at IS NOT NULL
     ON CONFLICT (repo_id, captured_on) DO UPDATE SET stars = EXCLUDED.stars`,
  )
  return rowCount ?? 0
}

function labelFor(dateKey: string): string {
  return trendingDateLabel(new Date(`${dateKey}T12:00:00+08:00`))
}

/**
 * 今日榜单：当前 stars 对比「今天之前最近一次快照」。
 * 如果快照不是昨天的，会标记为 multi-day，避免把多天增长说成一天。
 */
export async function loadDailyRanking(
  pool: DbPool,
  limit = 10,
  options: DailyRankingOptions = {},
): Promise<DailyRanking> {
  // 过滤官方框架时多取一些，避免被大厂项目占满后不够 10 条。
  const fetchLimit = options.includeOfficial ? limit : limit * 6
  const { rows } = await pool.query<{
    full_name: string
    stars: number
    previous_stars: number
    previous_date: string
    language: string | null
    summary: string | null
    topics: string[]
    inferred_topics: string[] | null
    created_at: string | null
  }>(
    `WITH prev AS (
       SELECT DISTINCT ON (repo_id) repo_id, captured_on, stars
       FROM star_snapshots
       WHERE captured_on < CURRENT_DATE
       ORDER BY repo_id, captured_on DESC
     )
     SELECT r.full_name, r.stars, p.stars AS previous_stars, p.captured_on::text AS previous_date,
            r.language, r.summary, r.topics, r.inferred_topics, r.created_at::text AS created_at
     FROM repos r
     JOIN prev p ON p.repo_id = r.id
     WHERE r.enriched_at IS NOT NULL AND r.stars > p.stars
     ORDER BY (r.stars - p.stars) DESC
     LIMIT $1`,
    [Math.max(1, fetchLimit)],
  )

  const items: DailyRankingItem[] = rows.map((row) => ({
    fullName: row.full_name,
    stars: row.stars,
    stars7d: row.previous_stars,
    previousStars: row.previous_stars,
    previousDate: row.previous_date,
    gain: row.stars - row.previous_stars,
    growth:
      row.previous_stars > 0
        ? Math.round(((row.stars - row.previous_stars) / row.previous_stars) * 10_000) / 10_000
        : 0,
    language: row.language,
    summary: row.summary,
    topics: row.topics,
    inferredTopics: row.inferred_topics ?? [],
    createdAt: row.created_at,
  }))

  const filtered = filterRankingRepos(items, options.includeOfficial ?? false).slice(0, limit)
  const previousDate = filtered[0]?.previousDate ?? null
  const basis: DailyRanking['basis'] =
    previousDate === new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
      ? 'day'
      : 'multi-day'

  return {
    dateKey: trendingDateKey(),
    dateLabel: trendingDateLabel(),
    basis,
    previousDate,
    items: filtered,
  }
}

/** 把今天的榜单（不筛官方，保留完整 Top50）落库，供之后按日期回看。 */
export async function persistDailyRanking(pool: DbPool): Promise<number> {
  const ranking = await loadDailyRanking(pool, 50, { includeOfficial: true })
  if (ranking.items.length === 0) return 0
  await pool.query(
    `INSERT INTO daily_rankings (date_key, basis, previous_date, items)
     VALUES ($1::date, $2, $3::date, $4)
     ON CONFLICT (date_key) DO UPDATE SET
       basis = EXCLUDED.basis,
       previous_date = EXCLUDED.previous_date,
       items = EXCLUDED.items,
       created_at = now()`,
    [ranking.dateKey, ranking.basis, ranking.previousDate, JSON.stringify(ranking.items)],
  )
  return ranking.items.length
}

export async function loadPersistedDailyRanking(
  pool: DbPool,
  dateKey: string,
  options: DailyRankingOptions = {},
): Promise<DailyRanking | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null
  const { rows } = await pool.query<{
    date_key: string
    basis: string
    previous_date: string | null
    items: DailyRankingItem[]
  }>(
    `SELECT date_key::text, basis, previous_date::text, items
     FROM daily_rankings WHERE date_key = $1::date LIMIT 1`,
    [dateKey],
  )
  const row = rows[0]
  if (!row || !Array.isArray(row.items)) return null
  return {
    dateKey: row.date_key,
    dateLabel: labelFor(row.date_key),
    basis: row.basis === 'day' ? 'day' : 'multi-day',
    previousDate: row.previous_date,
    items: filterRankingRepos(row.items, options.includeOfficial ?? false),
    persisted: true,
  }
}

export async function listDailyRankingDates(pool: DbPool, limit = 30): Promise<string[]> {
  const { rows } = await pool.query<{ date_key: string }>(
    `SELECT date_key::text FROM daily_rankings ORDER BY date_key DESC LIMIT $1`,
    [Math.max(1, limit)],
  )
  return rows.map((row) => row.date_key)
}

export function dailyTemplateCopy(ranking: DailyRanking): TrendingCopy {
  return {
    headline: `GitHub 每日飙升 Top${ranking.items.length}｜${ranking.dateLabel}`,
    intro:
      ranking.basis === 'day'
        ? '按今日 star 增量排序，数据来自 RepoRadar 的每日快照。'
        : `按最近一次快照（${ranking.previousDate ?? '未知日期'}）以来的增量排序；快照积累后会变成真正的每日榜。`,
    lines: Object.fromEntries(
      ranking.items.map((item) => [
        item.fullName,
        `${item.summary?.slice(0, 46) ?? `${item.language ?? '开源'} 项目`}（+${item.gain.toLocaleString('en-US')} stars）`,
      ]),
    ),
    hashtags: ['GitHub', '开源', '每日榜单'],
  }
}
