import { describe, expect, it } from 'vitest'
import {
  buildSearchQueries,
  isValidGithubClientId,
  isValidGithubClientSecret,
  mapGitHubRepo,
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

describe('mapGitHubRepo', () => {
  it('normalises a GitHub search payload', () => {
    const payload: GitHubRepoPayload = {
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
      fullName: 'acme/tool',
      owner: 'acme',
      topics: ['cli'],
      license: null,
      description: null,
    })
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
