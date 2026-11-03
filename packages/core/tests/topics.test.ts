import { describe, expect, it } from 'vitest'
import { normalizeTopicTags, parseInferredTopics } from '../src/topics.js'

describe('normalizeTopicTags', () => {
  it('normalizes case, spaces and invalid characters', () => {
    expect(normalizeTopicTags(['CLI Tool', 'schema_validation', 'llm agents', '--bad--'])).toEqual([
      'cli-tool',
      'schema-validation',
      'llm-agents',
      'bad',
    ])
  })

  it('dedupes and caps at six tags', () => {
    const tags = normalizeTopicTags(['aa', 'aa', 'bb', 'cc', 'dd', 'ee', 'ff', 'gg'])
    expect(tags).toEqual(['aa', 'bb', 'cc', 'dd', 'ee', 'ff'])
  })
})

describe('parseInferredTopics', () => {
  it('parses valid JSON with or without fences', () => {
    const raw = JSON.stringify({ topics: ['cli', 'argument-parser', 'nodejs'] })
    expect(parseInferredTopics(raw)).toEqual(['cli', 'argument-parser', 'nodejs'])
    expect(parseInferredTopics('```json\n' + raw + '\n```')).toHaveLength(3)
  })

  it('rejects fewer than two valid tags', () => {
    expect(() => parseInferredTopics(JSON.stringify({ topics: ['cli'] }))).toThrow(/至少需要 2 个/)
    expect(() => parseInferredTopics('not json')).toThrow(/无法解析/)
  })
})
