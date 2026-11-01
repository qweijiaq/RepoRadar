import { z } from 'zod'
import type { RepoInput } from './types.js'

export function githubApiBase(): string {
  return (process.env.GITHUB_API_BASE?.trim() || 'https://api.github.com').replace(/\/+$/, '')
}

export interface SearchWindow {
  min: number
  max: number | null
}

export interface QueryOptions {
  topics: string[]
  days: number
  windows: SearchWindow[]
  language?: string
  now?: Date
  /** 额外生成一组「最近创建」查询，用来发现刚出现的新项目。 */
  freshDays?: number
}

export interface SearchOptions {
  token?: string
  page?: number
  perPage?: number
  /** GitHub Search 排序；定时采集用 updated 可以发现新活跃项目。 */
  sort?: 'stars' | 'forks' | 'updated'
}

export interface GitHubRepoPayload {
  id?: number
  full_name: string
  name: string
  owner: { login: string }
  description: string | null
  html_url: string
  homepage: string | null
  language: string | null
  topics?: string[]
  stargazers_count: number
  forks_count: number
  open_issues_count: number
  license: { spdx_id?: string | null } | null
  archived: boolean
  fork: boolean
  pushed_at: string | null
  created_at: string | null
}

export const githubRepoPayloadSchema = z
  .object({
    id: z.number().int().optional(),
    full_name: z.string().min(1),
    name: z.string().min(1),
    owner: z.object({ login: z.string().min(1) }).passthrough(),
    description: z.string().nullable().optional(),
    html_url: z.string().url(),
    homepage: z.string().nullable().optional(),
    language: z.string().nullable().optional(),
    topics: z.array(z.string()).optional(),
    stargazers_count: z.number().int().nonnegative(),
    forks_count: z.number().int().nonnegative(),
    open_issues_count: z.number().int().nonnegative(),
    license: z
      .object({ spdx_id: z.string().nullable().optional() })
      .passthrough()
      .nullable()
      .optional(),
    archived: z.boolean(),
    fork: z.boolean(),
    pushed_at: z.string().nullable().optional(),
    created_at: z.string().nullable().optional(),
  })
  .passthrough()

export function parseGitHubRepoPayload(value: unknown): GitHubRepoPayload | null {
  const result = githubRepoPayloadSchema.safeParse(value)
  return result.success ? (result.data as GitHubRepoPayload) : null
}

export function buildSearchQueries(options: QueryOptions): string[] {
  const now = options.now ?? new Date()
  const since = new Date(now.getTime() - options.days * 86_400_000).toISOString().slice(0, 10)
  const topics = [...new Set(options.topics)]
  const queries: string[] = []

  for (const topic of topics) {
    for (const window of options.windows) {
      const parts = [
        `topic:${topic}`,
        `pushed:>=${since}`,
        'archived:false',
        'fork:false',
        window.max === null ? `stars:>=${window.min}` : `stars:${window.min}..${window.max}`,
      ]
      if (options.language) parts.push(`language:${options.language}`)
      queries.push(parts.join(' '))
    }
    if (options.freshDays && options.freshDays > 0) {
      const createdSince = new Date(now.getTime() - options.freshDays * 86_400_000)
        .toISOString()
        .slice(0, 10)
      const parts = [
        `topic:${topic}`,
        `pushed:>=${since}`,
        `created:>=${createdSince}`,
        'archived:false',
        'fork:false',
        'stars:>=50',
      ]
      if (options.language) parts.push(`language:${options.language}`)
      queries.push(parts.join(' '))
    }
  }
  return queries
}

export function mapGitHubRepo(raw: GitHubRepoPayload): RepoInput {
  return {
    githubId: raw.id ?? null,
    fullName: raw.full_name,
    owner: raw.owner.login,
    name: raw.name,
    description: raw.description || null,
    htmlUrl: raw.html_url,
    homepage: raw.homepage || null,
    language: raw.language || null,
    topics: raw.topics ?? [],
    stars: raw.stargazers_count,
    forks: raw.forks_count,
    openIssues: raw.open_issues_count,
    license: raw.license?.spdx_id || null,
    archived: raw.archived,
    isFork: raw.fork,
    pushedAt: raw.pushed_at,
    createdAt: raw.created_at,
  }
}

function githubHeaders(token?: string, accept = 'application/vnd.github+json'): Record<string, string> {
  const headers: Record<string, string> = {
    accept,
    'x-github-api-version': '2022-11-28',
    'user-agent': 'repo-radar',
  }
  if (token) headers.authorization = `Bearer ${token}`
  return headers
}

export class GitHubApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'GitHubApiError'
    this.status = status
  }
}

async function describeGitHubError(response: Response): Promise<string> {
  const remaining = response.headers.get('x-ratelimit-remaining')
  const reset = response.headers.get('x-ratelimit-reset')
  const body = (await response.text()).slice(0, 300)
  const hint =
    remaining === '0' && reset
      ? `（触发速率限制，约 ${new Date(Number(reset) * 1000).toLocaleTimeString()} 重置）`
      : ''
  return `GitHub API ${response.status}${hint}: ${body}`
}

export async function searchRepos(query: string, options: SearchOptions): Promise<RepoInput[]> {
  const params = new URLSearchParams({
    q: query,
    sort: options.sort ?? 'stars',
    order: 'desc',
    per_page: String(options.perPage ?? 50),
    page: String(options.page ?? 1),
  })
  const response = await fetch(`${githubApiBase()}/search/repositories?${params.toString()}`, {
    headers: githubHeaders(options.token),
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw new GitHubApiError(response.status, await describeGitHubError(response))
  const data = (await response.json()) as { items?: unknown }
  const repos: RepoInput[] = []
  let invalid = 0
  for (const item of Array.isArray(data.items) ? data.items : []) {
    const payload = parseGitHubRepoPayload(item)
    if (!payload) {
      invalid += 1
      continue
    }
    repos.push(mapGitHubRepo(payload))
  }
  if (invalid > 0) console.warn(`[github] 跳过 ${invalid} 个结构异常的搜索结果`)
  return repos
}

export async function fetchRepo(fullName: string, token?: string): Promise<RepoInput | null> {
  const response = await fetch(`${githubApiBase()}/repos/${fullName}`, {
    headers: githubHeaders(token),
    signal: AbortSignal.timeout(10_000),
  })
  if (response.status === 404) return null
  if (!response.ok) throw new GitHubApiError(response.status, await describeGitHubError(response))
  const payload = parseGitHubRepoPayload(await response.json())
  if (!payload) throw new GitHubApiError(502, 'GitHub 返回的仓库结构不符合预期')
  return mapGitHubRepo(payload)
}

export async function fetchReadme(fullName: string, token: string): Promise<string | null> {
  const response = await fetch(`${githubApiBase()}/repos/${fullName}/readme`, {
    headers: githubHeaders(token, 'application/vnd.github.raw'),
    signal: AbortSignal.timeout(10_000),
  })
  if (response.status === 404) return null
  if (!response.ok) throw new GitHubApiError(response.status, await describeGitHubError(response))
  return (await response.text()).slice(0, 20_000)
}

const CREDENTIAL_PATTERN = /^[A-Za-z0-9._-]+$/

export interface LatestRelease {
  tag: string
  name: string | null
  url: string | null
  publishedAt: string | null
}

export async function fetchLatestRelease(fullName: string, token?: string): Promise<LatestRelease | null> {
  const response = await fetch(`${githubApiBase()}/repos/${fullName}/releases/latest`, {
    headers: githubHeaders(token),
    signal: AbortSignal.timeout(10_000),
  })
  if (response.status === 404) return null
  if (!response.ok) throw new GitHubApiError(response.status, await describeGitHubError(response))

  const data = (await response.json()) as {
    tag_name?: string
    name?: string | null
    html_url?: string
    published_at?: string | null
  }
  if (!data.tag_name) return null
  return {
    tag: data.tag_name,
    name: data.name ?? null,
    url: data.html_url ?? null,
    publishedAt: data.published_at ?? null,
  }
}

export function isValidGithubClientId(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.length >= 10 && trimmed.length <= 100 && CREDENTIAL_PATTERN.test(trimmed)
}

export function isValidGithubClientSecret(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.length >= 20 && trimmed.length <= 200 && CREDENTIAL_PATTERN.test(trimmed)
}

export interface RepoFile {
  path: string
  content: string
  truncated: boolean
}

export async function fetchRepoFile(
  fullName: string,
  path: string,
  token?: string,
  maxBytes = 60_000,
): Promise<RepoFile | null> {
  const encoded = path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  const response = await fetch(`${githubApiBase()}/repos/${fullName}/contents/${encoded}`, {
    headers: githubHeaders(token, 'application/vnd.github.raw'),
    signal: AbortSignal.timeout(10_000),
  })
  if (response.status === 404) return null
  if (!response.ok) throw new GitHubApiError(response.status, await describeGitHubError(response))
  const text = await response.text()
  return {
    path,
    content: text.slice(0, maxBytes),
    truncated: text.length > maxBytes,
  }
}


/**
 * 读取 OAuth token 实际授予的 scope（GitHub 在响应头 x-oauth-scopes 返回）。
 * 细粒度 token 可能没有该响应头，此时返回 null，调用方应按未知处理。
 */
export async function fetchTokenScopes(token: string): Promise<string[] | null> {
  try {
    const response = await fetch(`${githubApiBase()}/user`, {
      headers: githubHeaders(token),
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) return null
    const raw = response.headers.get('x-oauth-scopes')
    if (raw === null) return null
    return raw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  } catch {
    return null
  }
}

export interface OpenIssue {
  number: number
  title: string
  url: string
  labels: string[]
  comments: number
  updatedAt: string | null
}

/** 拉取仓库最近的 open issue（过滤掉 Pull Request）。 */
export async function listOpenIssues(
  fullName: string,
  options: { token?: string | null; limit?: number } = {},
): Promise<OpenIssue[]> {
  const perPage = Math.max(5, Math.min(50, options.limit ?? 30))
  const response = await fetch(
    `${githubApiBase()}/repos/${fullName}/issues?state=open&sort=updated&direction=desc&per_page=${perPage}`,
    {
      headers: githubHeaders(options.token ?? undefined),
      signal: AbortSignal.timeout(10_000),
    },
  )
  if (!response.ok) throw new GitHubApiError(response.status, await describeGitHubError(response))
  const items = (await response.json()) as Array<{
    number?: number
    title?: string
    html_url?: string
    labels?: Array<{ name?: string } | string>
    comments?: number
    updated_at?: string | null
    pull_request?: unknown
  }>
  if (!Array.isArray(items)) return []
  return items
    .filter((item) => !item.pull_request && typeof item.number === 'number' && typeof item.title === 'string')
    .map((item) => ({
      number: item.number as number,
      title: item.title as string,
      url: item.html_url ?? `https://github.com/${fullName}/issues/${item.number}`,
      labels: (item.labels ?? [])
        .map((label) => (typeof label === 'string' ? label : (label.name ?? '')))
        .filter(Boolean),
      comments: item.comments ?? 0,
      updatedAt: item.updated_at ?? null,
    }))
}
