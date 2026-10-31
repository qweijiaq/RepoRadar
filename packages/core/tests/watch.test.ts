import { describe, expect, it } from 'vitest'
import {
  buildWatchPrompt,
  groundWatchReport,
  parseWatchReport,
  type WatchCandidate,
} from '../src/watch.js'

const candidates: WatchCandidate[] = [
  { repo: 'me/cache', summary: '缓存库', language: 'TypeScript', topics: ['cache'], stars: 100 },
  { repo: 'me/other', summary: '别的项目', language: 'Go', topics: ['cli'], stars: 50 },
]

describe('parseWatchReport', () => {
  it('parses matches and drops invalid entries', () => {
    const parsed = parseWatchReport(
      JSON.stringify({
        matches: [
          { repo: 'me/cache', score: 91, reason: '符合 TypeScript 缓存需求' },
          { repo: 'me/cache', score: 'bad', reason: 'x' },
        ],
      }),
    )
    expect(parsed.matches).toHaveLength(1)
  })

  it('accepts an empty match list', () => {
    expect(parseWatchReport('{"matches":[]}').matches).toEqual([])
  })

  it('rejects unrelated output', () => {
    expect(() => parseWatchReport('没有结果')).toThrow()
  })
})

describe('groundWatchReport', () => {
  it('keeps only known, unique candidates', () => {
    const report = parseWatchReport(
      JSON.stringify({
        matches: [
          { repo: 'me/cache', score: 91, reason: '匹配缓存' },
          { repo: 'ghost/repo', score: 90, reason: '不存在' },
          { repo: 'me/cache', score: 80, reason: '重复' },
        ],
      }),
    )
    const grounded = groundWatchReport(report, candidates)
    expect(grounded.matches.map((match) => match.repo)).toEqual(['me/cache'])
  })
})

describe('buildWatchPrompt', () => {
  it('includes the intent and candidate context', () => {
    const prompt = buildWatchPrompt('TypeScript 缓存', candidates)
    expect(prompt).toContain('TypeScript 缓存')
    expect(prompt).toContain('me/cache')
    expect(prompt).toContain('cache')
  })
})
