import { describe, expect, it } from 'vitest'
import {
  buildFeedbackContext,
  buildTasteProfile,
  cosineSimilarity,
  isExcluded,
  explainPersonalizedScore,
  personalizedScore,
  rankForUser,
  topicAffinity,
} from '../src/personalize.js'
import type { EnrichedRepoRecord } from '../src/types.js'

const NOW = Date.parse('2026-10-30T00:00:00Z')

function makeRepo(overrides: Partial<EnrichedRepoRecord> = {}): EnrichedRepoRecord {
  return {
    id: 1,
    fullName: 'acme/tool',
    owner: 'acme',
    name: 'tool',
    description: null,
    htmlUrl: 'https://github.com/acme/tool',
    homepage: null,
    language: 'TypeScript',
    topics: ['cli'],
    stars: 100,
    forks: 1,
    openIssues: 0,
    license: 'MIT',
    archived: false,
    isFork: false,
    pushedAt: '2026-10-20T00:00:00Z',
    createdAt: '2024-01-01T00:00:00Z',
    summary: null,
    problem: null,
    audience: null,
    verdict: 'recommend',
    reason: null,
    qualityScore: 0.8,
    stars7d: null,
    embedding: null,
    verifyStatus: null,
    verifiedAt: null,
    ...overrides,
  }
}

describe('buildTasteProfile', () => {
  it('normalises topic and language weights', () => {
    const profile = buildTasteProfile({
      starred: [
        { topics: ['cli', 'tool'], language: 'TypeScript', embedding: null },
        { topics: ['cli'], language: 'TypeScript', embedding: null },
        { topics: ['llm'], language: 'Python', embedding: null },
      ],
      now: new Date(NOW),
    })
    expect(profile.topicWeights.cli).toBe(1)
    expect(profile.topicWeights.tool).toBe(0.5)
    expect(profile.languageWeights.TypeScript).toBe(1)
    expect(profile.languageWeights.Python).toBe(0.5)
    expect(profile.starredCount).toBe(3)
  })

  it('weights recent activity above old signals', () => {
    const profile = buildTasteProfile({
      starred: [
        { topics: ['old'], language: 'Python', embedding: null, weight: 0.5, source: 'star' },
        { topics: ['recent'], language: 'TypeScript', embedding: null, weight: 3, source: 'owned' },
        { topics: ['recent'], language: 'TypeScript', embedding: null, weight: 2, source: 'event' },
      ],
      now: new Date(NOW),
    })
    expect(profile.topicWeights.recent).toBe(1)
    expect(profile.topicWeights.old).toBeCloseTo(0.1, 4)
    expect(profile.sourceCounts).toEqual({ stars: 1, owned: 1, events: 1 })
  })

  it('averages embeddings and keeps exclusions', () => {
    const profile = buildTasteProfile({
      starred: [
        { topics: [], language: null, embedding: [1, 0] },
        { topics: [], language: null, embedding: [0, 1] },
      ],
      excludedTopics: ['crypto'],
      excludedLanguages: ['PHP'],
      now: new Date(NOW),
    })
    expect(profile.embedding).toEqual([0.5, 0.5])
    expect(profile.excludedTopics).toEqual(['crypto'])
    expect(profile.excludedLanguages).toEqual(['PHP'])
  })
})

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors and 0 for orthogonal ones', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1)
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0)
  })
})

describe('topicAffinity', () => {
  it('averages the weights of matching topics', () => {
    const profile = buildTasteProfile({
      starred: [
        { topics: ['cli', 'tool'], language: null, embedding: null },
        { topics: ['cli'], language: null, embedding: null },
      ],
    })
    expect(topicAffinity(profile, ['cli'])).toBe(1)
    expect(topicAffinity(profile, ['tool'])).toBe(0.5)
    expect(topicAffinity(profile, ['cli', 'tool'])).toBe(0.75)
  })
})

describe('personalizedScore', () => {
  const profile = buildTasteProfile({
    starred: [
      { topics: ['cli'], language: 'TypeScript', embedding: null },
      { topics: ['cli'], language: 'TypeScript', embedding: null },
    ],
  })

  it('rewards repos that match the profile', () => {
    const matching = personalizedScore(profile, makeRepo({ topics: ['cli'] }), NOW)
    const unrelated = personalizedScore(profile, makeRepo({ topics: ['crypto'], language: 'Rust' }), NOW)
    expect(matching).toBeGreaterThan(unrelated)
  })

  it('returns -1 for excluded topics', () => {
    const excluded = buildTasteProfile({
      starred: [{ topics: ['cli'], language: null, embedding: null }],
      excludedTopics: ['crypto'],
    })
    expect(isExcluded(excluded, makeRepo({ topics: ['crypto'] }))).toBe(true)
    expect(personalizedScore(excluded, makeRepo({ topics: ['crypto'] }), NOW)).toBe(-1)
  })

  it('falls back to the global score without a profile', () => {
    const highQuality = personalizedScore(null, makeRepo({ qualityScore: 0.9 }), NOW)
    const lowQuality = personalizedScore(null, makeRepo({ qualityScore: 0.2 }), NOW)
    expect(highQuality).toBeGreaterThan(lowQuality)
  })
})

describe('explainPersonalizedScore', () => {
  it('returns a breakdown whose total matches personalizedScore', () => {
    const profile = buildTasteProfile({
      starred: [{ topics: ['cli'], language: 'TypeScript', embedding: null }],
    })
    const repo = makeRepo({ topics: ['cli'], qualityScore: 0.8 })
    const breakdown = explainPersonalizedScore(profile, repo, NOW)
    expect(breakdown.total).toBe(personalizedScore(profile, repo, NOW))
    expect(breakdown.global.contributions.quality).toBeGreaterThan(0)
    expect(breakdown.affinity?.topic).toBeGreaterThan(0)
    expect(breakdown.version).toBe('score@1')
  })

  it('reports adjustments separately', () => {
    const profile = buildTasteProfile({
      starred: [{ topics: ['cli'], language: 'TypeScript', embedding: null }],
    })
    const feedback = buildFeedbackContext(new Map([['acme/tool', 'save']]), [])
    const breakdown = explainPersonalizedScore(profile, makeRepo(), NOW, feedback)
    expect(breakdown.adjustments.feedback).toBeGreaterThan(0)
  })

  it('prefers a semantic score precomputed by pgvector over local embeddings', () => {
    const profile = buildTasteProfile({
      starred: [{ topics: ['cli'], language: 'TypeScript', embedding: [1, 0] }],
    })
    const close = explainPersonalizedScore(profile, makeRepo({ embedding: null, semanticScore: 0.9 }), NOW)
    const far = explainPersonalizedScore(profile, makeRepo({ embedding: null, semanticScore: 0 }), NOW)
    expect(close.affinity?.semantic).toBeCloseTo(0.9, 4)
    expect(far.affinity?.semantic).toBe(0)
    expect(close.total).toBeGreaterThan(far.total)
  })
})

describe('rankForUser', () => {
  it('ranks profile matches above unrelated high-quality repos', () => {
    const profile = buildTasteProfile({
      starred: [
        { topics: ['cli'], language: 'TypeScript', embedding: null },
        { topics: ['cli'], language: 'TypeScript', embedding: null },
      ],
    })
    const ranked = rankForUser(
      profile,
      [
        makeRepo({ fullName: 'x/unrelated', topics: ['crypto'], language: 'Rust', qualityScore: 0.95 }),
        makeRepo({ fullName: 'x/matching', topics: ['cli'], language: 'TypeScript', qualityScore: 0.65 }),
      ],
      NOW,
    )
    expect(ranked[0]?.fullName).toBe('x/matching')
  })

  it('drops skipped repos', () => {
    const ranked = rankForUser(null, [makeRepo({ verdict: 'skip' })], NOW)
    expect(ranked).toHaveLength(0)
  })
})
