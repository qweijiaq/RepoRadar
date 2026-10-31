import { round } from './utils.js'

export interface RisingInput {
  fullName: string
  stars: number
  stars7d: number | null
}

export function starGrowth(repo: RisingInput): number | null {
  if (repo.stars7d === null || repo.stars7d <= 0) return null
  return round((repo.stars - repo.stars7d) / repo.stars7d, 4)
}

/**
 * 按近 7 天 star 相对增速排序（不是绝对星数），只保留正增长。
 */
export function risingRepos<T extends RisingInput>(repos: T[], limit: number): Array<T & { growth: number }> {
  const scored: Array<{ repo: T; growth: number }> = []
  for (const repo of repos) {
    const growth = starGrowth(repo)
    if (growth !== null && growth > 0) scored.push({ repo, growth })
  }
  return scored
    .sort((a, b) => b.growth - a.growth)
    .slice(0, Math.max(0, limit))
    .map((entry) => ({ ...entry.repo, growth: entry.growth }))
}
