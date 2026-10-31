import { describe, expect, it } from 'vitest'
import type { FeedbackKind, FeedbackSignal } from '../src/feedback.js'
import {
  buildFeedbackContext,
  computeTopicAdjustments,
  personalizedScore,
  rankForUser,
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

describe('computeTopicAdjustments', () => {
  it('balances saves against hides per topic', () => {
    const signals: FeedbackSignal[] = [
      { topics: ['llm'], kind: 'save' },
      { topics: ['llm', 'crypto'], kind: 'hide' },
      { topics: ['crypto'], kind: 'hide' },
    ]
    const adjustments = computeTopicAdjustments(signals)
    expect(adjustments.llm).toBe(0)
    expect(adjustments.crypto).toBeLessThan(0)
    expect(adjustments.crypto).toBeGreaterThanOrEqual(-0.15)
  })

  it('caps a single topic adjustment', () => {
    const signals: FeedbackSignal[] = Array.from({ length: 10 }, () => ({ topics: ['rust'], kind: 'save' }))
    expect(computeTopicAdjustments(signals).rust).toBe(0.15)
  })
})

describe('buildFeedbackContext', () => {
  it('splits feedback into hidden and saved sets', () => {
    const feedback = new Map<string, FeedbackKind>([
      ['a/one', 'save'],
      ['a/two', 'hide'],
    ])
    const context = buildFeedbackContext(feedback, [])
    expect(context.saved.has('a/one')).toBe(true)
    expect(context.hidden.has('a/two')).toBe(true)
  })
})

describe('personalizedScore with feedback', () => {
  const feedback = new Map<string, FeedbackKind>([
    ['x/saved', 'save'],
    ['x/hidden', 'hide'],
  ])
  const context = buildFeedbackContext(feedback, [{ topics: ['cli'], kind: 'save' }])

  it('hides negatively rated repos', () => {
    expect(personalizedScore(null, makeRepo({ fullName: 'x/hidden' }), NOW, context)).toBe(-1)
  })

  it('boosts saved repos above identical peers', () => {
    const saved = personalizedScore(null, makeRepo({ fullName: 'x/saved' }), NOW, context)
    const peer = personalizedScore(null, makeRepo({ fullName: 'x/peer' }), NOW, context)
    expect(saved).toBeGreaterThan(peer)
  })

  it('applies topic adjustments from feedback', () => {
    const boosted = personalizedScore(null, makeRepo({ fullName: 'x/boosted', topics: ['cli'] }), NOW, context)
    const plain = personalizedScore(null, makeRepo({ fullName: 'x/plain', topics: ['other'] }), NOW, context)
    expect(boosted).toBeGreaterThan(plain)
  })
})

describe('rankForUser with feedback', () => {
  it('drops hidden repos from the ranking', () => {
    const feedback = new Map<string, FeedbackKind>([['x/hidden', 'hide']])
    const context = buildFeedbackContext(feedback, [])
    const ranked = rankForUser(null, [makeRepo({ fullName: 'x/hidden' }), makeRepo({ fullName: 'x/keep' })], NOW, context)
    expect(ranked.map((repo) => repo.fullName)).toEqual(['x/keep'])
  })
})

describe('subscriptions in ranking', () => {
  it('boosts repos that match a subscription', () => {
    const plain = personalizedScore(null, makeRepo({ fullName: 'x/plain' }), NOW)
    const boosted = personalizedScore(null, makeRepo({ fullName: 'x/boosted' }), NOW, null, [
      { kind: 'topic', value: 'cli' },
    ])
    expect(boosted).toBeGreaterThan(plain)
  })
})
