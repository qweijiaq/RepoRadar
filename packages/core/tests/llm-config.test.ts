import { afterEach, describe, expect, it } from 'vitest'
import type { DbPool } from '../src/db.js'
import { buildLlmConfig, envLlmSummary, loadStoredLlmStatus } from '../src/llm-config.js'
import { encryptSecret } from '../src/secret-box.js'

const originalSecret = process.env.AUTH_SECRET

afterEach(() => {
  if (originalSecret === undefined) delete process.env.AUTH_SECRET
  else process.env.AUTH_SECRET = originalSecret
})

function poolWith(value: unknown): DbPool {
  return {
    query: async () => ({ rows: value === undefined ? [] : [{ value }] }),
  } as unknown as DbPool
}

describe('buildLlmConfig', () => {
  it('derives the protocol and default base URL from the provider', () => {
    const config = buildLlmConfig({ providerId: 'deepseek', model: 'deepseek-flash', apiKey: 'key' })
    expect(config.protocol).toBe('openai')
    expect(config.baseUrl).toBe('https://api.deepseek.com/v1')
    expect(config.providerId).toBe('deepseek')
    expect(config.model).toBe('deepseek-flash')
  })

  it('supports anthropic and normalises a custom base URL', () => {
    const config = buildLlmConfig({
      providerId: 'anthropic',
      model: 'claude-sonnet-5',
      apiKey: 'key',
      baseUrl: 'https://example.com/v1/',
    })
    expect(config.protocol).toBe('anthropic')
    expect(config.baseUrl).toBe('https://example.com/v1')
  })

  it('rejects unknown providers', () => {
    expect(() => buildLlmConfig({ providerId: 'nope', model: 'x', apiKey: 'key' })).toThrow()
  })
})

describe('envLlmSummary', () => {
  it('returns null without an API key', () => {
    expect(envLlmSummary({})).toBeNull()
  })

  it('summarises env-based configuration', () => {
    const summary = envLlmSummary({
      LLM_API_KEY: 'key',
      LLM_PROVIDER: 'deepseek',
      LLM_MODEL: 'deepseek-flash',
    } as NodeJS.ProcessEnv)
    expect(summary).toEqual({
      providerId: 'deepseek',
      model: 'deepseek-flash',
      baseUrl: 'https://api.deepseek.com/v1',
    })
  })
})

describe('loadStoredLlmStatus', () => {
  it('reports missing when no row exists', async () => {
    const status = await loadStoredLlmStatus(poolWith(undefined))
    expect(status).toEqual({ state: 'missing', summary: null })
  })

  it('returns the saved summary with a key hint', async () => {
    process.env.AUTH_SECRET = 'status-secret'
    const status = await loadStoredLlmStatus(
      poolWith({
        providerId: 'openai',
        model: 'gpt-4o-mini',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: encryptSecret('sk-test-key-7890', 'status-secret'),
      }),
    )
    expect(status.state).toBe('ok')
    expect(status.summary?.model).toBe('gpt-4o-mini')
    expect(status.summary?.keyHint).toBe('7890')
  })

  it('reports unreadable when AUTH_SECRET changed', async () => {
    process.env.AUTH_SECRET = 'new-secret'
    const status = await loadStoredLlmStatus(
      poolWith({
        providerId: 'openai',
        model: 'gpt-4o-mini',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: encryptSecret('sk-test-key-7890', 'old-secret'),
      }),
    )
    expect(status).toEqual({ state: 'unreadable', summary: null })
  })
})
