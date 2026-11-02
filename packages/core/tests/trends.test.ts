import { describe, expect, it } from 'vitest'
import { aggregateTopicMomentum, fallbackTrendBrief, parseTrendBrief, type TrendStats } from '../src/trends.js'

describe('aggregateTopicMomentum', () => {
  it('averages growth per topic and keeps topics with at least two repos', () => {
    const topics = aggregateTopicMomentum([
      { topics: ['llm', 'ai'], stars: 1000, stars7d: 900 },
      { topics: ['llm'], stars: 500, stars7d: 400 },
      { topics: ['solo'], stars: 200, stars7d: 100 },
    ])
    const llm = topics.find((entry) => entry.topic === 'llm')
    expect(llm?.repos).toBe(2)
    expect(llm?.growth).toBeCloseTo(((1000 - 900) / 900 + (500 - 400) / 400) / 2, 3)
    expect(topics.some((entry) => entry.topic === 'solo')).toBe(false)
  })
})

describe('parseTrendBrief', () => {
  const brief = {
    headline: 'LLM 工具链继续领涨',
    points: [
      { title: '增长最快', detail: 'zod 一周涨了 8%。', repos: ['colinhacks/zod'] },
      { title: 'topic 动量', detail: '#llm 平均涨 6%。', repos: [] as string[] },
    ],
    watch: ['注意 star 增长和实际使用量的差异'],
  }

  it('parses a valid brief', () => {
    expect(parseTrendBrief(JSON.stringify(brief))).toEqual(brief)
  })

  it('rejects briefs with too few points', () => {
    expect(() => parseTrendBrief(JSON.stringify({ ...brief, points: brief.points.slice(0, 1) }))).toThrow(
      /结构不符合要求/,
    )
  })
})

describe('fallbackTrendBrief', () => {
  it('builds a data-only brief without a model', () => {
    const stats: TrendStats = {
      windowDays: 7,
      totalRepos: 10,
      risers: [
        { fullName: 'a/one', stars: 1000, growth: 0.1, language: 'TypeScript', summary: '', topics: [] },
      ],
      topics: [{ topic: 'llm', repos: 2, growth: 0.08, stars: 3000 }],
      newEntrants: [],
    }
    const brief = fallbackTrendBrief(stats)
    expect(brief.headline).toContain('a/one')
    expect(brief.points[0]?.repos).toEqual(['a/one'])
    expect(brief.points[1]?.title).toContain('#llm')
  })
})
