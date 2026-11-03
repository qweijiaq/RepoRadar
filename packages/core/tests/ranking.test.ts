import { describe, expect, it } from 'vitest'
import { filterRankingRepos, isOfficialFramework } from '../src/ranking.js'

describe('official framework filter', () => {
  it('detects large official orgs', () => {
    expect(isOfficialFramework('vercel/next.js')).toBe(true)
    expect(isOfficialFramework('facebook/react')).toBe(true)
    expect(isOfficialFramework('morluto/rea')).toBe(false)
    expect(isOfficialFramework('colinhacks/zod')).toBe(false)
  })

  it('filters official frameworks unless asked to include them', () => {
    const repos = [
      { fullName: 'vercel/next.js' },
      { fullName: 'freeCodeCamp/freeCodeCamp', stars: 400_000, createdAt: '2014-01-01T00:00:00Z' },
      { fullName: 'morluto/rea', stars: 400_000, createdAt: '2026-04-14T00:00:00Z' },
      { fullName: 'colinhacks/zod' },
    ]
    expect(filterRankingRepos(repos).map((repo) => repo.fullName)).toEqual([
      'morluto/rea',
      'colinhacks/zod',
    ])
    expect(filterRankingRepos(repos, true)).toHaveLength(4)
  })
})
