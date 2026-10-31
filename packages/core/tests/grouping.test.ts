import { describe, expect, it } from 'vitest'
import { groupByProfileTopic } from '../src/grouping.js'
import { buildTasteProfile } from '../src/personalize.js'

const profile = buildTasteProfile({
  starred: [
    { topics: ['cli'], language: 'TypeScript', embedding: null },
    { topics: ['cli'], language: 'TypeScript', embedding: null },
    { topics: ['llm'], language: 'Python', embedding: null },
  ],
})

function repo(fullName: string, topics: string[], score: number) {
  return { fullName, topics, score }
}

describe('groupByProfileTopic', () => {
  it('groups by the most profile-relevant topic and sorts groups by score', () => {
    const groups = groupByProfileTopic(
      [
        repo('a/cli', ['cli', 'llm'], 0.9),
        repo('a/llm', ['llm'], 0.8),
        repo('a/other', ['unknown'], 0.7),
      ],
      profile,
      { maxGroups: 3, perGroup: 5 },
    )
    expect(groups.map((group) => group.topic)).toEqual(['cli', 'llm', 'unknown'])
    expect(groups[0]?.repos[0]?.fullName).toBe('a/cli')
  })

  it('caps groups and repos per group', () => {
    const groups = groupByProfileTopic(
      [repo('a/one', ['one'], 0.9), repo('a/two', ['two'], 0.8), repo('a/three', ['three'], 0.7)],
      null,
      { maxGroups: 2, perGroup: 1 },
    )
    expect(groups).toHaveLength(2)
    expect(groups.every((group) => group.repos.length === 1)).toBe(true)
  })

  it('falls back to 其他 for repos without topics', () => {
    const groups = groupByProfileTopic([repo('a/none', [], 0.5)], profile)
    expect(groups[0]?.topic).toBe('其他')
  })
})
