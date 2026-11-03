import { describe, expect, it, vi } from 'vitest'
import {
  buildSearchQueries,
  isValidGithubClientId,
  isValidGithubClientSecret,
  mapGitHubRepo,
  parseGitHubRepoPayload,
  searchRepos,
  type GitHubRepoPayload,
} from '../src/github.js'

describe('buildSearchQueries', () => {
  const now = new Date('2026-10-30T00:00:00Z')

  it('builds one query per topic and star window', () => {
    const queries = buildSearchQueries({
      topics: ['llm', 'cli'],
      days: 30,
      windows: [
        { min: 50, max: 500 },
        { min: 5000, max: null },
      ],
      now,
    })
    expect(queries).toEqual([
      'topic:llm pushed:>=2026-09-30 archived:false fork:false stars:50..500',
      'topic:llm pushed:>=2026-09-30 archived:false fork:false stars:>=5000',
      'topic:cli pushed:>=2026-09-30 archived:false fork:false stars:50..500',
      'topic:cli pushed:>=2026-09-30 archived:false fork:false stars:>=5000',
    ])
  })

  it('adds a recently-created query for discovery', () => {
    const queries = buildSearchQueries({
      topics: ['llm'],
      days: 30,
      windows: [{ min: 50, max: 500 }],
      freshDays: 120,
      now,
    })
    expect(queries).toEqual([
      'topic:llm pushed:>=2026-09-30 archived:false fork:false stars:50..500',
      'topic:llm pushed:>=2026-09-30 created:>=2026-07-02 archived:false fork:false stars:>=50',
      'created:>=2026-07-02 stars:>=1000 archived:false fork:false',
    ])
  })

  it('deduplicates topics and applies the language filter', () => {
    const queries = buildSearchQueries({
      topics: ['llm', 'llm'],
      days: 7,
      windows: [{ min: 100, max: 200 }],
      language: 'TypeScript',
      now,
    })
    expect(queries).toEqual([
      'topic:llm pushed:>=2026-10-23 archived:false fork:false stars:100..200 language:TypeScript',
    ])
  })
})

describe('searchRepos', () => {
  it('passes the requested sort to GitHub Search', async () => {
    const calls: string[] = []
    const mock = vi.fn(async (url: string | URL | Request) => {
      calls.push(String(url))
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', mock)
    try {
      await searchRepos('topic:llm', { sort: 'updated', perPage: 20 })
      expect(calls[0]).toContain('sort=updated')
      expect(calls[0]).toContain('per_page=20')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('mapGitHubRepo', () => {
  it('normalises a GitHub search payload', () => {
    const payload: GitHubRepoPayload = {
      id: 101,
      full_name: 'acme/tool',
      name: 'tool',
      owner: { login: 'acme' },
      description: null,
      html_url: 'https://github.com/acme/tool',
      homepage: null,
      language: null,
      topics: ['cli'],
      stargazers_count: 12,
      forks_count: 3,
      open_issues_count: 1,
      license: null,
      archived: false,
      fork: false,
      pushed_at: null,
      created_at: null,
    }
    expect(mapGitHubRepo(payload)).toMatchObject({
      githubId: 101,
      fullName: 'acme/tool',
      owner: 'acme',
      topics: ['cli'],
      license: null,
      description: null,
    })
  })
})

describe('parseGitHubRepoPayload', () => {
  const payload = {
    id: 101,
    full_name: 'acme/tool',
    name: 'tool',
    owner: { login: 'acme', id: 1 },
    description: null,
    html_url: 'https://github.com/acme/tool',
    homepage: null,
    language: 'TypeScript',
    topics: ['cli'],
    stargazers_count: 12,
    forks_count: 3,
    open_issues_count: 1,
    license: { spdx_id: 'MIT', name: 'MIT License' },
    archived: false,
    fork: false,
    pushed_at: null,
    created_at: null,
    extra: 'ignored',
  }

  it('accepts a realistic payload and ignores extra fields', () => {
    expect(parseGitHubRepoPayload(payload)).toMatchObject({ id: 101, full_name: 'acme/tool' })
  })

  it('rejects payloads missing required fields', () => {
    expect(parseGitHubRepoPayload({ full_name: 'acme/tool' })).toBeNull()
    expect(parseGitHubRepoPayload(null)).toBeNull()
  })
})

describe('credential validation', () => {
  it('accepts realistic client ids and secrets', () => {
    expect(isValidGithubClientId('Ov23liAbCdEfGhIjKlMn')).toBe(true)
    expect(isValidGithubClientSecret('a1b2c3d4e5f60718293a4b5c6d7e8f9012345678')).toBe(true)
  })

  it('rejects values that are too short or contain spaces', () => {
    expect(isValidGithubClientId('short')).toBe(false)
    expect(isValidGithubClientSecret('too short')).toBe(false)
    expect(isValidGithubClientSecret('has a space in the middle of the secret')).toBe(false)
  })
})
