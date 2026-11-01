import { describe, expect, it } from 'vitest'
import { recordLlmUsage, withLlmUsage } from '../src/usage.js'

describe('withLlmUsage', () => {
  it('collects usage from inside the callback and flushes it', async () => {
    let flushed: unknown = null
    const result = await withLlmUsage(
      async () => {
        recordLlmUsage({
          providerId: 'deepseek',
          model: 'deepseek-flash',
          promptTokens: 120,
          completionTokens: 40,
          latencyMs: 300,
        })
        return 'answer'
      },
      async (usage) => {
        flushed = usage
      },
    )

    expect(result).toBe('answer')
    expect(flushed).toEqual([
      {
        providerId: 'deepseek',
        model: 'deepseek-flash',
        promptTokens: 120,
        completionTokens: 40,
        latencyMs: 300,
      },
    ])
  })

  it('attaches prompt and score versions from the surrounding context', async () => {
    let flushed: unknown = null
    await withLlmUsage(
      async () => {
        recordLlmUsage({
          providerId: null,
          model: 'x',
          promptTokens: 1,
          completionTokens: 2,
          latencyMs: 3,
        })
      },
      async (usage) => {
        flushed = usage
      },
      { promptVersion: 'enrich@1', scoreVersion: 'score@1' },
    )
    expect(flushed).toEqual([expect.objectContaining({ promptVersion: 'enrich@1', scoreVersion: 'score@1' })])
  })

  it('flushes usage even when the callback throws', async () => {
    let flushed: unknown = null
    await expect(
      withLlmUsage(
        async () => {
          recordLlmUsage({
            providerId: null,
            model: 'x',
            promptTokens: 1,
            completionTokens: 2,
            latencyMs: 3,
          })
          throw new Error('boom')
        },
        async (usage) => {
          flushed = usage
        },
      ),
    ).rejects.toThrow('boom')
    expect(flushed).toHaveLength(1)
  })
})
