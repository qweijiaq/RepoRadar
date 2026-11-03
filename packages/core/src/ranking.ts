/** 大厂/官方框架类仓库，默认不进「飙升榜」，避免榜单被 next.js / react 这类项目占满。 */
export const OFFICIAL_FRAMEWORK_OWNERS = [
  'vercel',
  'facebook',
  'reactjs',
  'tailwindlabs',
  'shadcn-ui',
  'microsoft',
  'google',
  'angular',
  'vuejs',
  'sveltejs',
  'nodejs',
  'denoland',
  'rust-lang',
  'golang',
  'kubernetes',
  'tensorflow',
  'pytorch',
  'huggingface',
  'openai',
  'anthropics',
  'langchain-ai',
  'modelcontextprotocol',
] as const

const OFFICIAL_OWNERS = new Set<string>(OFFICIAL_FRAMEWORK_OWNERS)

export function isOfficialFramework(fullName: string): boolean {
  const owner = fullName.split('/')[0]?.toLowerCase() ?? ''
  return OFFICIAL_OWNERS.has(owner)
}

/** 超过 10 万 star 且建库超过 2 年的「老牌巨无霸」，同样不进飙升榜。 */
export function isOldGiant(repo: { stars?: number | null; createdAt?: string | null }): boolean {
  if (typeof repo.stars !== 'number' || repo.stars < 100_000) return false
  if (!repo.createdAt) return false
  const created = Date.parse(repo.createdAt)
  if (!Number.isFinite(created)) return false
  return Date.now() - created > 2 * 365 * 86_400_000
}

/** 按 owner 过滤榜单候选；默认剔除官方框架，`includeOfficial: true` 时返回全部。 */
export function filterRankingRepos<
  T extends { fullName: string; stars?: number | null; createdAt?: string | null },
>(repos: T[], includeOfficial = false): T[] {
  if (includeOfficial) return repos
  return repos.filter((repo) => !isOfficialFramework(repo.fullName) && !isOldGiant(repo))
}
