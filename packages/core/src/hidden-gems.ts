import { createHash } from 'node:crypto'
import { GitHubApiError, searchRepos } from './github.js'
import type { EnrichedRepoRecord, RepoInput } from './types.js'

const DAY_MS = 86_400_000
const MAX_AGE_DAYS = 3 * 365
const MAX_PUSH_DAYS = 120
const CACHE_TTL = 10 * 60 * 1000

export const MEGA_OWNERS = new Set([
  'google',
  'google-gemini',
  'google-research',
  'microsoft',
  'facebook',
  'meta',
  'aws',
  'amazon',
  'apple',
  'netflix',
  'vercel',
  'openai',
  'anthropic',
  'huggingface',
  'langchain-ai',
  'angular',
  'qwenlm',
  'ollama',
  'n8n-io',
  'storybookjs',
  'expo',
  'nestjs',
  'ant-design',
  'ionic-team',
  'mermaid-js',
  'trpc',
  'nrwl',
  'firecrawl',
])

const LIST_PATTERN =
  /(^|[-_/])(awesome|list|lists|collection|curated|roadmap|interview|tutorial|tutorials|cheatsheet|cheat-sheet|resources|book|books|course|courses|guide)([-_/]|$)/i
const LIST_TOPICS = new Set([
  'awesome',
  'awesome-list',
  'awesome-lists',
  'tutorial',
  'tutorials',
  'interview',
  'interview-questions',
  'roadmap',
  'resources',
  'book',
  'books',
  'course',
  'cheatsheet',
])

export interface HiddenGemContext {
  languages: string[]
  topics: string[]
  exclude?: Set<string>
  now?: Date
  token?: string | null
  limit?: number
  /** 用户反馈「不是我的栈」后，只保留同语言项目 */
  requireLanguage?: boolean
  /** 用户反馈「太宽泛」后，只保留命中具体 topic 的项目 */
  requireTopic?: boolean
  maxAgeDays?: number
  sort?: 'score' | 'fresh'
  /** 用户主动刷新时跳过服务端搜索缓存 */
  fresh?: boolean
}

export interface HiddenGem {
  repo: RepoInput
  score: number
  reasons: string[]
  stars7d: number | null
  source: 'search' | 'library'
}

interface SearchCacheEntry {
  expires: number
  repos: RepoInput[]
}

const searchCache = new Map<string, SearchCacheEntry>()
const invalidTokens = new Map<string, number>()

const warnedTokens = new Map<string, number>()
const INVALID_TOKEN_TTL = 5 * 60 * 1000

function tokenKey(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** 当前进程内是否已确认该 GitHub token 失效（用于页面提示）。 */
export function isGithubTokenInvalid(token: string | null | undefined, now = new Date()): boolean {
  if (!token) return false
  return (invalidTokens.get(tokenKey(token)) ?? 0) > now.getTime()
}

export function isMegaOwner(fullName: string): boolean {
  return MEGA_OWNERS.has(fullName.split('/')[0]?.toLowerCase() ?? '')
}

export function isListLikeRepo(repo: {
  name: string
  fullName: string
  description: string | null
  topics: string[]
}): boolean {
  if (LIST_PATTERN.test(repo.name) || LIST_PATTERN.test(repo.fullName)) return true
  if (repo.topics.some((topic) => LIST_TOPICS.has(topic.toLowerCase()))) return true
  return Boolean(repo.description && LIST_PATTERN.test(repo.description))
}

function daysBetween(now: number, value: string | null): number {
  if (!value) return Number.POSITIVE_INFINITY
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return Number.POSITIVE_INFINITY
  return Math.max(0, Math.floor((now - time) / DAY_MS))
}

function hasContext(repo: RepoInput, context: HiddenGemContext): { language: boolean; topic: string | null } {
  const language = Boolean(repo.language && context.languages.includes(repo.language))
  const topic =
    repo.topics.find((item) => context.topics.some((candidate) => candidate.toLowerCase() === item.toLowerCase())) ??
    null
  return { language, topic }
}

export function isHiddenGemCandidate(repo: RepoInput, context: HiddenGemContext): boolean {
  const now = (context.now ?? new Date()).getTime()
  if (repo.archived || repo.isFork) return false
  if (repo.stars < 50 || repo.stars > 5000) return false
  if (!repo.description || repo.description.trim().length < 12) return false
  if (isMegaOwner(repo.fullName) || isListLikeRepo(repo)) return false
  if (daysBetween(now, repo.createdAt) > (context.maxAgeDays ?? MAX_AGE_DAYS)) return false
  if (daysBetween(now, repo.pushedAt) > MAX_PUSH_DAYS) return false
  if (context.exclude?.has(repo.fullName.toLowerCase())) return false

  const overlap = hasContext(repo, context)
  if (context.requireLanguage && !overlap.language) return false
  if (context.requireTopic && !overlap.topic) return false
  // 既不同语言也不沾主题的完全不相关项目不进默认雷达
  return overlap.language || Boolean(overlap.topic) || context.languages.length === 0
}

function scoreGem(repo: RepoInput, context: HiddenGemContext, stars7d: number | null): number {
  const now = (context.now ?? new Date()).getTime()
  const pushDays = daysBetween(now, repo.pushedAt)
  const ageDays = daysBetween(now, repo.createdAt)
  const freshness = Number.isFinite(pushDays) ? Math.max(0, 1 - pushDays / MAX_PUSH_DAYS) : 0
  const youth = Number.isFinite(ageDays)
    ? Math.max(0, 1 - ageDays / (context.maxAgeDays ?? MAX_AGE_DAYS))
    : 0
  const sweetSpot = Math.max(0, 1 - Math.abs(Math.log10(Math.max(repo.stars, 1)) - Math.log10(800)) / 2)

  let velocity = 0.45
  if (stars7d !== null && stars7d > 0) {
    const growth = (repo.stars - stars7d) / stars7d
    velocity = Math.min(1, Math.max(0, growth * 4))
  }

  const overlap = hasContext(repo, context)
  const relevance = (overlap.language ? 0.6 : 0) + (overlap.topic ? 0.4 : 0)

  return Number(
    (0.28 * freshness + 0.18 * youth + 0.16 * sweetSpot + 0.24 * velocity + 0.14 * relevance).toFixed(4),
  )
}

function buildReasons(repo: RepoInput, context: HiddenGemContext, stars7d: number | null): string[] {
  const now = (context.now ?? new Date()).getTime()
  const reasons: string[] = []
  const pushDays = daysBetween(now, repo.pushedAt)
  const ageDays = daysBetween(now, repo.createdAt)
  const overlap = hasContext(repo, context)

  if (Number.isFinite(pushDays) && pushDays <= 14) reasons.push(`${pushDays === 0 ? '今天' : `${pushDays} 天前`}还在更新`)
  if (stars7d !== null && stars7d > 0 && repo.stars > stars7d) {
    const growth = ((repo.stars - stars7d) / stars7d) * 100
    if (growth >= 2) reasons.push(`7 天 star +${growth.toFixed(0)}%`)
  }
  if (Number.isFinite(ageDays) && ageDays < 365) {
    reasons.push(`${Math.max(1, Math.round(ageDays / 30))} 个月前创建`)
  }
  if (overlap.language) reasons.push(`和你的 ${repo.language} 项目同栈`)
  if (overlap.topic) reasons.push(`也在 ${overlap.topic} 方向`)
  if (reasons.length === 0) reasons.push(`${repo.stars} stars，仍在早期`)
  return reasons.slice(0, 3)
}

export function rankHiddenGems(
  repos: Array<RepoInput & { stars7d?: number | null }>,
  context: HiddenGemContext,
): HiddenGem[] {
  const seen = new Set<string>()
  const limit = context.limit ?? 12
  return repos
    .filter((repo) => {
      const key = repo.fullName.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return isHiddenGemCandidate(repo, context)
    })
    .map((repo) => {
      const stars7d = repo.stars7d ?? null
      return {
        repo,
        score: scoreGem(repo, context, stars7d),
        reasons: buildReasons(repo, context, stars7d),
        stars7d,
        source: 'search' as const,
      }
    })
    .sort((left, right) => {
      if (context.sort === 'fresh') {
        return (Date.parse(right.repo.createdAt ?? '') || 0) - (Date.parse(left.repo.createdAt ?? '') || 0)
      }
      return right.score - left.score
    })
    .slice(0, limit)
}

function toRepoInput(repo: EnrichedRepoRecord): RepoInput {
  return {
    fullName: repo.fullName,
    owner: repo.owner,
    name: repo.name,
    description:
      repo.summary && repo.summary.trim().length >= 12 ? repo.summary : repo.description,
    htmlUrl: repo.htmlUrl,
    homepage: repo.homepage,
    language: repo.language,
    topics: repo.topics,
    stars: repo.stars,
    forks: repo.forks,
    openIssues: repo.openIssues,
    license: repo.license,
    archived: repo.archived,
    isFork: repo.isFork,
    pushedAt: repo.pushedAt,
    createdAt: repo.createdAt,
  }
}

export function hiddenGemsFromLibrary(repos: EnrichedRepoRecord[], context: HiddenGemContext): HiddenGem[] {
  const withMomentum = repos.map((repo) => ({ ...toRepoInput(repo), stars7d: repo.stars7d }))
  return rankHiddenGems(withMomentum, context).map((gem) => ({ ...gem, source: 'library' }))
}

function dateString(now: Date, daysBack: number): string {
  return new Date(now.getTime() - daysBack * DAY_MS).toISOString().slice(0, 10)
}

function buildQueries(context: HiddenGemContext, now: Date): string[] {
  const created = dateString(now, context.maxAgeDays ?? MAX_AGE_DAYS)
  const pushed = dateString(now, MAX_PUSH_DAYS)
  const base = `stars:50..5000 created:>=${created} pushed:>=${pushed} archived:false fork:false`
  const queries: string[] = []
  for (const language of context.languages.slice(0, 2)) {
    const value = /^[A-Za-z0-9_-]+$/.test(language)
      ? language
      : `"${language.replace(/"/g, '')}"`
    queries.push(`language:${value} ${base}`)
  }
  for (const topic of context.topics.slice(0, 2)) {
    queries.push(`topic:${topic.toLowerCase()} ${base}`)
  }
  return [...new Set(queries)]
}

/**
 * 从 GitHub 现场搜小而活跃的项目，避免默认池被官方仓库占满。
 * 失败时返回空数组，由页面回退到已收录候选。
 */
export async function discoverHiddenGems(
  token: string | null,
  context: HiddenGemContext,
): Promise<HiddenGem[]> {
  if (!token) return []
  const now = context.now ?? new Date()
  const key = tokenKey(token)
  if ((invalidTokens.get(key) ?? 0) > now.getTime()) return []
  const queries = buildQueries(context, now)
  if (queries.length === 0) return []

  const cacheKey = JSON.stringify({ queries, hour: Math.floor(now.getTime() / CACHE_TTL) })
  const cached = context.fresh ? undefined : searchCache.get(cacheKey)
  if (cached && cached.expires > now.getTime()) {
    return rankHiddenGems(cached.repos, context)
  }

  const found = new Map<string, RepoInput>()
  const batches = await Promise.all(
    queries.map(async (query) => {
      try {
        return await searchRepos(query, { token, perPage: 10 })
      } catch (error) {
        if (error instanceof GitHubApiError && error.status === 401) {
          invalidTokens.set(key, now.getTime() + INVALID_TOKEN_TTL)
          if ((warnedTokens.get(key) ?? 0) <= now.getTime()) {
            warnedTokens.set(key, now.getTime() + INVALID_TOKEN_TTL)
            console.warn('[gems] GitHub token 已失效，暂停现场搜索；请重新登录 GitHub。')
          }
        } else {
          console.warn('[gems] GitHub 搜索失败：', error instanceof Error ? error.message : String(error))
        }
        return []
      }
    }),
  )
  for (const repos of batches) {
    for (const repo of repos) {
      if (!found.has(repo.fullName)) found.set(repo.fullName, repo)
    }
  }

  const repos = [...found.values()]
  searchCache.set(cacheKey, { repos, expires: now.getTime() + CACHE_TTL })
  return rankHiddenGems(repos, context)
}
