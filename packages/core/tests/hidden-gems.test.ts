import { describe, expect, it } from 'vitest'
import {
  discoverHiddenGems,
  hiddenGemsFromLibrary,
  isHiddenGemCandidate,
  isListLikeRepo,
  isMegaOwner,
  rankHiddenGems,
  type HiddenGemContext,
} from '../src/hidden-gems.js'
import type { EnrichedRepoRecord, RepoInput } from '../src/types.js'

const now = new Date('2026-10-31T00:00:00Z')
const context: HiddenGemContext = {
  languages: ['TypeScript'],
  topics: ['ai-agent'],
  now,
}

function repo(overrides: Partial<RepoInput> = {}): RepoInput {
  return {
    fullName: 'indie/tool',
    owner: 'indie',
    name: 'tool',
    description: '一个面向终端用户的小型 AI agent 工具',
    htmlUrl: 'https://github.com/indie/tool',
    homepage: null,
    language: 'TypeScript',
    topics: ['ai-agent', 'cli'],
    stars: 800,
    forks: 40,
    openIssues: 3,
    license: 'MIT',
    archived: false,
    isFork: false,
    pushedAt: '2026-10-29T00:00:00Z',
    createdAt: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('hidden gem filters', () => {
  it('accepts small, active, relevant projects', () => {
    expect(isHiddenGemCandidate(repo(), context)).toBe(true)
  })

  it('rejects mega owners, lists, huge and stale repos', () => {
    expect(isMegaOwner('vercel/next.js')).toBe(true)
    expect(isListLikeRepo({ ...repo(), name: 'awesome-agents', fullName: 'indie/awesome-agents' })).toBe(true)
    expect(isHiddenGemCandidate(repo({ stars: 20_000 }), context)).toBe(false)
    expect(isHiddenGemCandidate(repo({ pushedAt: '2025-01-01T00:00:00Z' }), context)).toBe(false)
    expect(isHiddenGemCandidate(repo({ fullName: 'vercel/tool', owner: 'vercel' }), context)).toBe(false)
  })

  it('rejects unrelated repos when a stack context exists', () => {
    expect(isHiddenGemCandidate(repo({ language: 'Ruby', topics: ['rails'] }), context)).toBe(false)
  })

  it('applies stricter filters after negative feedback', () => {
    expect(
      isHiddenGemCandidate(repo({ language: 'Ruby', topics: ['ai-agent'] }), {
        ...context,
        requireLanguage: true,
      }),
    ).toBe(false)
    expect(
      isHiddenGemCandidate(repo({ language: 'TypeScript', topics: ['rails'] }), {
        ...context,
        requireTopic: true,
      }),
    ).toBe(false)
  })
})

describe('rankHiddenGems', () => {
  it('ranks relevant gems and explains why', () => {
    const gems = rankHiddenGems(
      [
        repo(),
        repo({
          fullName: 'indie/other',
          name: 'other',
          stars: 2000,
          language: 'Go',
          topics: ['devops'],
          createdAt: '2024-01-01T00:00:00Z',
          pushedAt: '2026-09-01T00:00:00Z',
        }),
      ],
      context,
    )
    expect(gems).toHaveLength(1)
    expect(gems[0]?.repo.fullName).toBe('indie/tool')
    expect(gems[0]?.reasons.some((reason) => reason.includes('TypeScript'))).toBe(true)
  })

  it('uses star velocity from the library when available', () => {
    const enriched = {
      ...repo(),
      id: 1,
      summary: '一个小工具',
      problem: null,
      audience: null,
      verdict: 'try',
      reason: null,
      qualityScore: 0.7,
      stars7d: 700,
      embedding: null,
      verifyStatus: null,
      verifiedAt: null,
    } as EnrichedRepoRecord
    const gems = hiddenGemsFromLibrary([enriched], context)
    expect(gems[0]?.stars7d).toBe(700)
    expect(gems[0]?.reasons.some((reason) => reason.includes('7 天 star'))).toBe(true)
  })
})

describe('discoverHiddenGems', () => {
  it('returns empty without a token', async () => {
    await expect(discoverHiddenGems(null, context)).resolves.toEqual([])
  })
})
