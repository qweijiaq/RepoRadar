/**
 * 自己仓库的管理接口。删除仓库需要 OAuth 的 delete_repo scope。
 */
export const GITHUB_BASE_SCOPES = 'read:user user:email'
/** 读取私有仓库、Issue/PR 和管理仓库需要的常用权限。 */
export const GITHUB_REPO_SCOPES = 'read:user user:email repo'
/** 删除仓库是不可恢复操作，单独申请 delete_repo，避免日常授权过宽。 */
export const GITHUB_DELETE_REPO_SCOPES = 'read:user user:email repo delete_repo'

export function hasRepoScope(scope: string | null | undefined): boolean {
  return scopeList(scope).includes('repo')
}

export function hasDeleteRepoScope(scope: string | null | undefined): boolean {
  return scopeList(scope).includes('delete_repo')
}

function scopeList(scope: string | null | undefined): string[] {
  return (scope ?? '')
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export interface ManagedRepo {
  id: number
  fullName: string
  owner: string
  name: string
  description: string | null
  private: boolean
  archived: boolean
  fork: boolean
  defaultBranch: string
  stars: number
  htmlUrl: string
  pushedAt: string | null
  updatedAt: string | null
}

export interface CreateRepoInput {
  name: string
  description?: string
  private?: boolean
  autoInit?: boolean
  gitignoreTemplate?: string
  licenseTemplate?: string
}

export interface UpdateRepoInput {
  name?: string
  description?: string
  private?: boolean
  archived?: boolean
  defaultBranch?: string
}

export interface BatchResult<T, R> {
  item: T
  value?: R
  error?: string
}

export class GitHubManageError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'GitHubManageError'
    this.status = status
  }

  get needsReauth(): boolean {
    return this.status === 401 || (this.status === 403 && !/rate limit/i.test(this.message))
  }
}

interface ManagedRepoPayload {
  id: number
  full_name: string
  name: string
  owner?: { login?: string } | null
  description: string | null
  private: boolean
  archived: boolean
  fork: boolean
  default_branch?: string | null
  stargazers_count?: number
  html_url: string
  pushed_at: string | null
  updated_at?: string | null
}

function apiBase(): string {
  return (process.env.GITHUB_API_BASE?.trim() || 'https://api.github.com').replace(/\/+$/, '')
}

function headers(token: string, json = false): Record<string, string> {
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'x-github-api-version': '2022-11-28',
    'user-agent': 'repo-radar',
    ...(json ? { 'content-type': 'application/json' } : {}),
  }
}

async function githubRequest<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: headers(token, Boolean(init.body)),
    cache: 'no-store',
  } as RequestInit & { cache: 'no-store' })

  if (!response.ok) {
    const text = await response.text()
    let message = text.slice(0, 300)
    try {
      const parsed = JSON.parse(text) as { message?: string; errors?: Array<{ message?: string }> }
      message = parsed.errors?.find((entry) => entry.message)?.message ?? parsed.message ?? message
    } catch {
      // 保留原始文本
    }
    throw new GitHubManageError(response.status, message || `GitHub API 返回 ${response.status}`)
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

function mapRepo(raw: ManagedRepoPayload): ManagedRepo {
  return {
    id: raw.id,
    fullName: raw.full_name,
    owner: raw.owner?.login ?? raw.full_name.split('/')[0] ?? '',
    name: raw.name,
    description: raw.description,
    private: raw.private,
    archived: raw.archived,
    fork: raw.fork,
    defaultBranch: raw.default_branch ?? 'main',
    stars: raw.stargazers_count ?? 0,
    htmlUrl: raw.html_url,
    pushedAt: raw.pushed_at,
    updatedAt: raw.updated_at ?? null,
  }
}

export function validateRepoName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new GitHubManageError(0, '仓库名不能为空')
  if (trimmed.length > 100) throw new GitHubManageError(0, '仓库名不能超过 100 个字符')
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed) || trimmed === '.' || trimmed === '..') {
    throw new GitHubManageError(0, '仓库名只能包含字母、数字、点、下划线和连字符')
  }
  return trimmed
}

function validateFullName(fullName: string): string {
  const trimmed = fullName.trim()
  const parts = trimmed.split('/')
  if (parts.length !== 2) throw new GitHubManageError(0, '仓库格式应为 owner/name')
  validateRepoName(parts[1] ?? '')
  return trimmed
}

export async function listOwnedRepos(
  token: string,
  options: { page?: number; perPage?: number } = {},
): Promise<ManagedRepo[]> {
  const params = new URLSearchParams({
    affiliation: 'owner',
    sort: 'updated',
    direction: 'desc',
    per_page: String(Math.min(options.perPage ?? 100, 100)),
    page: String(Math.max(options.page ?? 1, 1)),
  })
  const repos = await githubRequest<ManagedRepoPayload[]>(token, `/user/repos?${params.toString()}`)
  return Array.isArray(repos) ? repos.map(mapRepo) : []
}

export async function getAuthenticatedLogin(token: string): Promise<string | null> {
  const user = await githubRequest<{ login?: string }>(token, '/user')
  return typeof user.login === 'string' && user.login.length > 0 ? user.login : null
}

export async function createRepository(token: string, input: CreateRepoInput): Promise<ManagedRepo> {
  const body: Record<string, unknown> = {
    name: validateRepoName(input.name),
    private: Boolean(input.private),
    auto_init: Boolean(input.autoInit),
  }
  if (input.description?.trim()) body.description = input.description.trim().slice(0, 350)
  if (input.gitignoreTemplate) body.gitignore_template = input.gitignoreTemplate
  if (input.licenseTemplate) body.license_template = input.licenseTemplate

  const repo = await githubRequest<ManagedRepoPayload>(token, '/user/repos', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return mapRepo(repo)
}

export async function updateRepository(
  token: string,
  fullName: string,
  input: UpdateRepoInput,
): Promise<ManagedRepo> {
  const body: Record<string, unknown> = {}
  if (input.name !== undefined) body.name = validateRepoName(input.name)
  if (input.description !== undefined) body.description = input.description.trim().slice(0, 350)
  if (input.private !== undefined) body.private = input.private
  if (input.archived !== undefined) body.archived = input.archived
  if (input.defaultBranch !== undefined) body.default_branch = input.defaultBranch.trim()
  if (Object.keys(body).length === 0) throw new GitHubManageError(0, '没有需要修改的字段')

  const repo = await githubRequest<ManagedRepoPayload>(token, `/repos/${validateFullName(fullName)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
  return mapRepo(repo)
}

export async function deleteRepository(token: string, fullName: string): Promise<void> {
  await githubRequest<void>(token, `/repos/${validateFullName(fullName)}`, { method: 'DELETE' })
}

export function normalizeTopics(topics: string[]): string[] {
  const normalized = topics
    .map((topic) =>
      topic
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, ''),
    )
    .filter((topic) => topic.length >= 2 && topic.length <= 50)
  return [...new Set(normalized)].slice(0, 20)
}

export async function updateRepositoryTopics(
  token: string,
  fullName: string,
  topics: string[],
): Promise<string[]> {
  const names = normalizeTopics(topics)
  await githubRequest<{ names?: string[] }>(token, `/repos/${validateFullName(fullName)}/topics`, {
    method: 'PUT',
    body: JSON.stringify({ names }),
  })
  return names
}

export async function runBatch<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<Array<BatchResult<T, R>>> {
  const results = new Array<BatchResult<T, R>>(items.length)
  let index = 0

  async function next(): Promise<void> {
    while (index < items.length) {
      const current = index++
      const item = items[current] as T
      try {
        results[current] = { item, value: await worker(item) }
      } catch (error) {
        results[current] = { item, error: error instanceof Error ? error.message : String(error) }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, next))
  return results
}
