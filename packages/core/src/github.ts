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
}

export interface SearchOptions {
  token?: string
  page?: number
  perPage?: number
}

export interface GitHubRepoPayload {
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
  }
  return queries
}

export function mapGitHubRepo(raw: GitHubRepoPayload): RepoInput {
  return {
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
    sort: 'stars',
    order: 'desc',
    per_page: String(options.perPage ?? 50),
    page: String(options.page ?? 1),
  })
  const response = await fetch(`${githubApiBase()}/search/repositories?${params.toString()}`, {
    headers: githubHeaders(options.token),
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw new GitHubApiError(response.status, await describeGitHubError(response))
  const data = (await response.json()) as { items?: GitHubRepoPayload[] }
  return (data.items ?? []).map(mapGitHubRepo)
}

export async function fetchReadme(fullName: string, token: string): Promise<string | null> {
  const response = await fetch(`${githubApiBase()}/repos/${fullName}/readme`, {
    headers: githubHeaders(token, 'application/vnd.github.raw'),
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
