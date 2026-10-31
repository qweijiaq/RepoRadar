import { describe, expect, it } from 'vitest'
import { risingRepos, starGrowth } from '../src/rising.js'

describe('starGrowth', () => {
  it('computes relative growth', () => {
    expect(starGrowth({ fullName: 'a/b', stars: 110, stars7d: 100 })).toBe(0.1)
  })

  it('returns null without a baseline', () => {
    expect(starGrowth({ fullName: 'a/b', stars: 110, stars7d: null })).toBeNull()
  })
})

describe('risingRepos', () => {
  it('keeps positive growth and sorts by rate, not absolute stars', () => {
    const repos = [
      { fullName: 'big/steady', stars: 100000, stars7d: 99000 },
      { fullName: 'small/fast', stars: 120, stars7d: 100 },
      { fullName: 'flat/one', stars: 500, stars7d: 500 },
      { fullName: 'no/baseline', stars: 300, stars7d: null },
    ]
    const rising = risingRepos(repos, 2)
    expect(rising.map((repo) => repo.fullName)).toEqual(['small/fast', 'big/steady'])
  })

  it('returns an empty list when nothing grew', () => {
    expect(risingRepos([{ fullName: 'a/b', stars: 100, stars7d: 100 }], 5)).toEqual([])
  })
})
