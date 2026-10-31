import { describe, expect, it } from 'vitest'
import { diversifyRanking } from '../src/diversity.js'

interface Item {
  fullName: string
  topics: string[]
  language: string | null
  score: number
}

function makeItem(fullName: string, topics: string[], language: string | null, score: number): Item {
  return { fullName, topics, language, score }
}

describe('diversifyRanking', () => {
  it('caps repeated topics when alternatives exist', () => {
    const items = [
      makeItem('a/llm-1', ['llm'], 'Python', 0.95),
      makeItem('a/llm-2', ['llm'], 'Python', 0.9),
      makeItem('a/llm-3', ['llm'], 'Python', 0.85),
      makeItem('a/rust-1', ['rust'], 'Rust', 0.6),
    ]
    const picked = diversifyRanking(items, { limit: 3, maxPerTopic: 2 })
    expect(picked.map((item) => item.fullName)).toEqual(['a/llm-1', 'a/llm-2', 'a/rust-1'])
  })

  it('caps the share of a single language', () => {
    const items = [
      makeItem('a/ts-1', ['one'], 'TypeScript', 0.95),
      makeItem('a/ts-2', ['two'], 'TypeScript', 0.9),
      makeItem('a/ts-3', ['three'], 'TypeScript', 0.85),
      makeItem('a/go-1', ['four'], 'Go', 0.5),
    ]
    const picked = diversifyRanking(items, { limit: 3, maxPerLanguage: 2 })
    expect(picked.map((item) => item.fullName)).toEqual(['a/ts-1', 'a/ts-2', 'a/go-1'])
  })

  it('relaxes caps when there are not enough candidates', () => {
    const items = [
      makeItem('a/llm-1', ['llm'], 'Python', 0.95),
      makeItem('a/llm-2', ['llm'], 'Python', 0.9),
      makeItem('a/llm-3', ['llm'], 'Python', 0.85),
    ]
    const picked = diversifyRanking(items, { limit: 3, maxPerTopic: 1 })
    expect(picked).toHaveLength(3)
  })

  it('returns an empty list for a zero limit', () => {
    expect(diversifyRanking([makeItem('a/x', ['x'], null, 1)], { limit: 0 })).toEqual([])
  })
})
