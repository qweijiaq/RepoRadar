import type { DbPool } from './db.js'
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

/**
 * 今日榜单：当前 stars 对比「今天之前最近一次快照」。
 * 如果快照不是昨天的，会标记为 multi-day，避免把多天增长说成一天。
 */
export async function loadDailyRanking(pool: DbPool, limit = 10): Promise<DailyRanking> {
  const { rows } = await pool.query<{
    full_name: string
    stars: number
    previous_stars: number
    previous_date: string
    language: string | null
    summary: string | null
    topics: string[]
  }>(
    `WITH prev AS (
       SELECT DISTINCT ON (repo_id) repo_id, captured_on, stars
       FROM star_snapshots
       WHERE captured_on < CURRENT_DATE
       ORDER BY repo_id, captured_on DESC
     )
     SELECT r.full_name, r.stars, p.stars AS previous_stars, p.captured_on::text AS previous_date,
            r.language, r.summary, r.topics
     FROM repos r
     JOIN prev p ON p.repo_id = r.id
     WHERE r.enriched_at IS NOT NULL AND r.stars > p.stars
     ORDER BY (r.stars - p.stars) DESC
     LIMIT $1`,
    [Math.max(1, limit)],
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
  }))

  const previousDate = items[0]?.previousDate ?? null
  const basis: DailyRanking['basis'] =
    previousDate === new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
      ? 'day'
      : 'multi-day'

  return {
    dateKey: trendingDateKey(),
    dateLabel: trendingDateLabel(),
    basis,
    previousDate,
    items,
  }
}

export function dailyTemplateCopy(ranking: DailyRanking): TrendingCopy {
  return {
    headline: `GitHub 每日飙升 Top10｜${ranking.dateLabel}`,
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
