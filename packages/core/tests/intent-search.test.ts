import { describe, expect, it } from 'vitest'
import {
  filterIntentCandidates,
  parseIntentQuery,
  parseRerankResult,
  type SearchIntent,
} from '../src/intent-search.js'
import type { EnrichedRepoRecord } from '../src/types.js'

function repo(
  fullName: string,
  overrides: Partial<EnrichedRepoRecord> = {},
): EnrichedRepoRecord {
  const [owner, name] = fullName.split('/')
  return {
    id: 1,
    owner,
    name,
    fullName,
    description: '',
    htmlUrl: `https://github.com/${fullName}`,
    homepage: null,
    language: 'TypeScript',
    topics: [],
    stars: 100,
    forks: 0,
    openIssues: 0,
    license: null,
    archived: false,
    isFork: false,
    pushedAt: null,
    createdAt: null,
    summary: '',
    problem: '',
    audience: '',
    verdict: '',
    reason: '',
    qualityScore: 0.5,
    embedding: null,
    verifyStatus: 'skipped',
    verifiedAt: null,
    ...overrides,
  } as unknown as EnrichedRepoRecord
}

const intent: SearchIntent = {
  keywords: ['pdf', 'table'],
  language: 'TypeScript',
  topics: ['pdf'],
  minStars: 500,
  mustHave: [],
  avoid: ['商业版'],
  summary: '',
}

describe('parseIntentQuery', () => {
  it('parses JSON with or without fences', () => {
    const raw = JSON.stringify({
      keywords: ['pdf'],
      language: null,
      topics: [],
      minStars: 0,
      mustHave: [],
      avoid: [],
      summary: '解析 PDF',
    })
    expect(parseIntentQuery(raw).keywords).toEqual(['pdf'])
    expect(parseIntentQuery('```json\n' + raw + '\n```').keywords).toEqual(['pdf'])
  })

  it('rejects invalid intents', () => {
    expect(() => parseIntentQuery('{}')).toThrow(/结构不符合要求|无法解析/)
  })
})

describe('filterIntentCandidates', () => {
  it('filters by language, stars, topics and avoid words', () => {
    const repos = [
      repo('a/good', { topics: ['pdf'], stars: 1000, summary: 'PDF table parser' }),
      repo('b/python', { language: 'Python', topics: ['pdf'], stars: 1000 }),
      repo('c/small', { topics: ['pdf'], stars: 10 }),
      repo('d/wrong-topic', { topics: ['web'], stars: 1000 }),
      repo('e/commercial', { topics: ['pdf'], stars: 1000, summary: 'PDF 商业版 表格' }),
    ]
    const filtered = filterIntentCandidates(repos, intent)
    expect(filtered.map((item) => item.fullName)).toEqual(['a/good'])
  })
})

describe('parseRerankResult', () => {
  it('keeps only candidate repos, clamps fit and respects limit', () => {
    const candidates = [repo('a/one'), repo('b/two'), repo('c/three')]
    const raw = JSON.stringify({
      answer: '按匹配度排序',
      results: [
        { repo: 'a/one', fit: 120, why: '匹配', gaps: '无明显缺口' },
        { repo: 'evil/repo', fit: 90, why: '不存在', gaps: '' },
        { repo: 'b/two', fit: 40, why: '次选', gaps: '缺文档' },
      ],
    })
    const parsed = parseRerankResult(raw, candidates, 2)
    expect(parsed.answer).toBe('按匹配度排序')
    expect(parsed.results).toHaveLength(2)
    expect(parsed.results[0]).toMatchObject({ fit: 100 })
    expect(parsed.results.map((hit) => hit.repo.fullName)).toEqual(['a/one', 'b/two'])
  })
})
