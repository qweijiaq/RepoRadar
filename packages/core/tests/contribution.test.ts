import { describe, expect, it } from 'vitest'
import { isFriendlyIssue, rankContributionTargets } from '../src/contribution.js'

describe('isFriendlyIssue', () => {
  it('recognises common beginner labels', () => {
    expect(isFriendlyIssue({ labels: ['good first issue'] })).toBe(true)
    expect(isFriendlyIssue({ labels: ['help wanted'] })).toBe(true)
    expect(isFriendlyIssue({ labels: ['good first issue', 'bug'] })).toBe(true)
    expect(isFriendlyIssue({ labels: ['bug'] })).toBe(false)
    expect(isFriendlyIssue({ labels: [] })).toBe(false)
  })
})

describe('rankContributionTargets', () => {
  it('dedupes repos by name and keeps the highest similarity', () => {
    const ranked = rankContributionTargets(
      [
        { repo: { fullName: 'a/one' }, similarity: 0.4, project: 'me/app' },
        { repo: { fullName: 'A/One' }, similarity: 0.7, project: 'me/other' },
        { repo: { fullName: 'b/two' }, similarity: 0.5, project: 'me/app' },
      ],
      2,
    )
    expect(ranked).toHaveLength(2)
    expect(ranked[0]?.repo.fullName).toBe('A/One')
    expect(ranked[1]?.repo.fullName).toBe('b/two')
  })
})
