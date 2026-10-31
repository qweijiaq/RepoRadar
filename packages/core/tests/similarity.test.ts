import { describe, expect, it } from 'vitest'
import { findSimilarRepos, repoSimilarity } from '../src/similarity.js'

const target = { fullName: 'a/target', topics: ['cli', 'agent'], language: 'TypeScript', embedding: [1, 0] }

describe('repoSimilarity', () => {
  it('returns 1 for identical topics, language and embedding', () => {
    expect(
      repoSimilarity(target, {
        fullName: 'a/same',
        topics: ['cli', 'agent'],
        language: 'TypeScript',
        embedding: [1, 0],
      }),
    ).toBe(1)
  })

  it('scores partial topic overlap above no overlap', () => {
    const partial = repoSimilarity(target, {
      fullName: 'a/partial',
      topics: ['cli'],
      language: 'TypeScript',
      embedding: null,
    })
    const none = repoSimilarity(target, {
      fullName: 'a/none',
      topics: ['crypto'],
      language: 'Rust',
      embedding: null,
    })
    expect(partial).toBeGreaterThan(none)
    expect(none).toBe(0)
  })
})

describe('findSimilarRepos', () => {
  it('excludes the target, sorts by similarity and limits the result', () => {
    const results = findSimilarRepos(
      target,
      [
        target,
        { fullName: 'a/close', topics: ['cli', 'agent'], language: 'TypeScript', embedding: null },
        { fullName: 'a/far', topics: ['crypto'], language: 'Rust', embedding: null },
        { fullName: 'a/mid', topics: ['cli'], language: 'TypeScript', embedding: null },
      ],
      2,
    )
    expect(results.map((entry) => entry.repo.fullName)).toEqual(['a/close', 'a/mid'])
  })
})
