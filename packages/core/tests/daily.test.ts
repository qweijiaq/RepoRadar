import { describe, expect, it } from 'vitest'
import { dailyTemplateCopy, type DailyRanking } from '../src/daily.js'

describe('dailyTemplateCopy', () => {
  const base: DailyRanking = {
    dateKey: '2026-11-03',
    dateLabel: '11月3日',
    basis: 'day',
    previousDate: '2026-11-02',
    items: [
      {
        fullName: 'a/one',
        stars: 120,
        stars7d: 100,
        previousStars: 100,
        previousDate: '2026-11-02',
        gain: 20,
        growth: 0.2,
        language: 'TypeScript',
        summary: '一个测试项目',
        topics: [],
      },
    ],
  }

  it('labels a true daily comparison', () => {
    const copy = dailyTemplateCopy(base)
    expect(copy.headline).toContain('11月3日')
    expect(copy.intro).toContain('今日')
    expect(copy.lines['a/one']).toContain('+20')
  })

  it('labels multi-day comparisons honestly', () => {
    const copy = dailyTemplateCopy({ ...base, basis: 'multi-day', previousDate: '2026-10-27' })
    expect(copy.intro).toContain('2026-10-27')
    expect(copy.intro).toContain('增量')
  })
})
