import { describe, expect, it } from 'vitest'
import { computeMomentum, computeNewness, computeScore, rankRepos } from '../src/score.js'

const NOW = Date.parse('2026-10-30T00:00:00Z')

describe('computeNewness', () => {
  it('scores a recent push close to 1', () => {
    expect(computeNewness('2026-10-29T00:00:00Z', NOW)).toBeCloseTo(1 - 1 / 90, 5)
  })

  it('returns 0 beyond the 90 day window', () => {
    expect(computeNewness('2026-01-01T00:00:00Z', NOW)).toBe(0)
  })

  it('returns 0 when the push date is unknown', () => {
    expect(computeNewness(null, NOW)).toBe(0)
  })
})

describe('computeMomentum', () => {
  it('is neutral without a baseline snapshot', () => {
    expect(computeMomentum(1000, null)).toBe(0.5)
  })

  it('clamps strong growth at 1', () => {
    expect(computeMomentum(1100, 1000)).toBe(1)
  })

  it('clamps a decline at 0', () => {
    expect(computeMomentum(800, 1000)).toBe(0)
  })
})

describe('computeScore', () => {
  it('combines quality, newness and momentum with fixed weights', () => {
    expect(computeScore({ quality: 1, newness: 1, momentum: 1 })).toBe(1)
    expect(computeScore({ quality: 0.8, newness: 0.6, momentum: 0.5 })).toBe(0.675)
  })

  it('treats a missing quality score as 0', () => {
    expect(computeScore({ quality: null, newness: 0, momentum: 0 })).toBe(0)
  })
})

describe('rankRepos', () => {
  it('ranks a fresh, fast-growing repo above an older high-quality one', () => {
    const ranked = rankRepos(
      [
        { qualityScore: 0.9, pushedAt: '2026-01-01T00:00:00Z', stars: 100, stars7d: null },
        { qualityScore: 0.5, pushedAt: '2026-10-29T00:00:00Z', stars: 100, stars7d: 50 },
      ],
      NOW,
    )
    expect(ranked[0]?.qualityScore).toBe(0.5)
    expect(ranked[1]?.qualityScore).toBe(0.9)
  })
})
