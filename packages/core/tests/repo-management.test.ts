import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  createRepository,
  deleteRepository,
  getAuthenticatedLogin,
  hasDeleteRepoScope,
  hasRepoScope,
  GitHubManageError,
  listOwnedRepos,
  runBatch,
  updateRepository,
  validateRepoName,
} from '../src/repo-management.js'

const payload = {
  id: 42,
  full_name: 'demo/app',
  name: 'app',
  owner: { login: 'demo' },
  description: '示例仓库',
  private: false,
  archived: false,
  fork: false,
  default_branch: 'main',
  stargazers_count: 7,
  html_url: 'https://github.com/demo/app',
  pushed_at: '2026-10-30T08:00:00Z',
  updated_at: '2026-10-30T09:00:00Z',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeAll(() => {
  process.env.GITHUB_API_BASE = 'https://mock.github.test'
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('listOwnedRepos', () => {
  it('lists owned repos and maps fields', async () => {
    const fetchMock = vi.fn(async () => jsonResponse([payload]))
    vi.stubGlobal('fetch', fetchMock)

    const repos = await listOwnedRepos('token-1')
    expect(repos).toEqual([
      {
        id: 42,
        fullName: 'demo/app',
        owner: 'demo',
        name: 'app',
        description: '示例仓库',
        private: false,
        archived: false,
        fork: false,
        defaultBranch: 'main',
        stars: 7,
        htmlUrl: 'https://github.com/demo/app',
        pushedAt: '2026-10-30T08:00:00Z',
        updatedAt: '2026-10-30T09:00:00Z',
      },
    ])

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/user/repos?')
    expect(url).toContain('affiliation=owner')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer token-1')
  })
})

describe('getAuthenticatedLogin', () => {
  it('reads the token owner login', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ login: 'demo' })))
    await expect(getAuthenticatedLogin('token')).resolves.toBe('demo')
  })
})

describe('createRepository', () => {  it('posts the creation payload', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(payload, 201))
    vi.stubGlobal('fetch', fetchMock)

    const repo = await createRepository('token-2', {
      name: 'app',
      description: '示例仓库',
      private: true,
      autoInit: true,
      gitignoreTemplate: 'Node',
      licenseTemplate: 'mit',
    })

    expect(repo.fullName).toBe('demo/app')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://mock.github.test/user/repos')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      name: 'app',
      description: '示例仓库',
      private: true,
      auto_init: true,
      gitignore_template: 'Node',
      license_template: 'mit',
    })
  })

  it('rejects an invalid repo name before calling GitHub', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(createRepository('token', { name: 'bad repo' })).rejects.toBeInstanceOf(GitHubManageError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('updateRepository', () => {
  it('patches only the provided fields', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ...payload, private: true }))
    vi.stubGlobal('fetch', fetchMock)

    const repo = await updateRepository('token-3', 'demo/app', { private: true, description: '新描述' })
    expect(repo.private).toBe(true)

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://mock.github.test/repos/demo/app')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(String(init.body))).toEqual({ description: '新描述', private: true })
  })

  it('refuses an empty patch', async () => {
    await expect(updateRepository('token', 'demo/app', {})).rejects.toThrow('没有需要修改的字段')
  })
})

describe('deleteRepository', () => {
  it('sends DELETE and accepts 204', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(deleteRepository('token-4', 'demo/app')).resolves.toBeUndefined()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://mock.github.test/repos/demo/app')
    expect(init.method).toBe('DELETE')
  })

  it('marks permission errors as needing reauthorization', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ message: 'Resource not accessible by integration' }, 403)),
    )

    const error = await deleteRepository('token', 'demo/app').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(GitHubManageError)
    expect((error as GitHubManageError).status).toBe(403)
    expect((error as GitHubManageError).needsReauth).toBe(true)
  })
})

describe('validation and batches', () => {
  it('accepts normal repo names', () => {
    expect(validateRepoName('my-repo_1.0')).toBe('my-repo_1.0')
    expect(() => validateRepoName('..')).toThrow()
  })

  it('runs batches with partial failures and keeps order', async () => {
    const results = await runBatch(['a', 'b', 'c'], 2, async (item) => {
      if (item === 'b') throw new Error('boom')
      return item.toUpperCase()
    })
    expect(results.map((result) => result.value ?? result.error)).toEqual(['A', 'boom', 'C'])
  })
})


describe('hasRepoScope', () => {
  it('distinguishes base login from repo management scopes', () => {
    expect(hasRepoScope('read:user user:email')).toBe(false)
    expect(hasRepoScope('read:user user:email public_repo')).toBe(false)
    expect(hasRepoScope('read:user user:email repo delete_repo')).toBe(true)
    expect(hasRepoScope(null)).toBe(false)
  })

  it('separates delete_repo from ordinary repo management', () => {
    expect(hasDeleteRepoScope('read:user user:email repo')).toBe(false)
    expect(hasDeleteRepoScope('read:user user:email repo delete_repo')).toBe(true)
    expect(hasDeleteRepoScope(null)).toBe(false)
  })
})
