import { describe, expect, it } from 'vitest'
import {
  buildTrendingText,
  parseTrendingCopy,
  selectTrendingItems,
  templateTrendingCopy,
  type TrendingItem,
  type TrendingPost,
} from '../src/trending.js'

const items: TrendingItem[] = [
  { fullName: 'a/big', stars: 10_000, stars7d: 9_000, gain: 1_000, growth: 0.1111, language: 'TypeScript', summary: 'big', topics: [] },
  { fullName: 'b/small', stars: 2_000, stars7d: 1_900, gain: 100, growth: 0.0526, language: 'Go', summary: 'small', topics: [] },
]

describe('selectTrendingItems', () => {
  it('sorts by absolute gain and drops repos without a 7-day snapshot', () => {
    const selected = selectTrendingItems(
      [
        { ...items[1]!, stars7d: 1_900 },
        { ...items[0]!, stars7d: 9_000 },
        { fullName: 'c/na', stars: 5_000, stars7d: null, language: null, summary: null, topics: [] },
      ],
      10,
    )
    expect(selected.map((item) => item.fullName)).toEqual(['a/big', 'b/small'])
    expect(selected[0]?.gain).toBe(1_000)
  })
})

describe('buildTrendingText', () => {
  it('renders a copyable post with rank, gains and hashtags', () => {
    const post: TrendingPost = {
      dateKey: '2026-11-03',
      dateLabel: '11月3日',
      generatedAt: null,
      model: null,
      items,
      velocity: [{ fullName: 'a/big', stars: 10_000, starsPerDay: 500, createdAt: '2026-01-01T00:00:00Z' }],
      copy: templateTrendingCopy(items),
    }
    const text = buildTrendingText(post)
    expect(text).toContain('1. a/big — +1,000 stars')
    expect(text).toContain('2. b/small — +100 stars')
    expect(text).toContain('#GitHub')
    expect(text).toContain('数据来自 RepoRadar')
    expect(text).toContain('新库速度榜')
    expect(text).toContain('a/big — 500/天')
  })
})

describe('parseTrendingCopy', () => {
  const valid = {
    headline: 'zod 断层第一',
    intro: '本周 TypeScript 工具最猛',
    lines: { 'a/big': '类型校验首选', 'evil/repo': '不该出现' },
    hashtags: ['GitHub', '开源', 'TypeScript'],
  }

  it('keeps only lines for known repos', () => {
    const copy = parseTrendingCopy(JSON.stringify(valid), items)
    expect(copy.lines).toEqual({ 'a/big': '类型校验首选' })
    expect(copy.hashtags).toContain('开源')
  })

  it('rejects invalid output', () => {
    expect(() => parseTrendingCopy(JSON.stringify({ ...valid, headline: '' }), items)).toThrow(
      /结构不符合要求|无法解析/,
    )
  })
})
