import { afterEach, describe, expect, it, vi } from 'vitest'
import { deriveWatchSearchQueries, fallbackWatchMatches } from '../src/watch.js'

const config = {
  apiKey: 'test-key',
  baseUrl: 'https://example.invalid/v1',
  model: 'test-model',
  embeddingModel: 'test-embedding',
}

describe('deriveWatchSearchQueries', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('parses and trims model-generated GitHub keywords', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content:
                    '```json\n{"queries":["agent long-term memory","agent memory store","vector memory agents"]}\n```',
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    )
    const queries = await deriveWatchSearchQueries('agent 长期记忆', config)
    expect(queries).toEqual(['agent long-term memory', 'agent memory store', 'vector memory agents'])
  })

  it('returns an empty list when the model output is unusable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: 'not json' } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    expect(await deriveWatchSearchQueries('anything', config)).toEqual([])
  })
})


describe('fallbackWatchMatches', () => {
  it('uses intent keywords and language when the model output is unusable', () => {
    const matches = fallbackWatchMatches('TypeScript 写的 AI Agent 项目', [
      {
        repo: 'acme/agent-ts',
        summary: 'A TypeScript AI agent framework for building autonomous workflows.',
        language: 'TypeScript',
        topics: ['ai-agents', 'typescript'],
        stars: 300,
      },
      {
        repo: 'acme/python-agent',
        summary: 'Python AI agent toolkit.',
        language: 'Python',
        topics: ['ai-agents'],
        stars: 1000,
      },
      {
        repo: 'acme/colors',
        summary: 'A color palette library.',
        language: 'TypeScript',
        topics: ['design'],
        stars: 50,
      },
    ])
    expect(matches[0]?.repo).toBe('acme/agent-ts')
    expect(matches.map((match) => match.repo)).not.toContain('acme/colors')
    expect(matches[0]?.reason).toContain('回退')
  })
})
