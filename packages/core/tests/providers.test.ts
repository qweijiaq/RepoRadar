import { describe, expect, it } from 'vitest'
import { findLlmModel, findLlmProvider, LLM_PROVIDERS } from '../src/providers.js'

describe('LLM provider catalog', () => {
  it('exposes the same providers as x-code', () => {
    expect(LLM_PROVIDERS.map((provider) => provider.id)).toEqual([
      'anthropic',
      'openai',
      'deepseek',
      'alibaba',
      'google',
      'xai',
      'zhipu',
      'moonshotai',
    ])
  })

  it('has unique ids, valid defaults and endpoints', () => {
    const ids = new Set<string>()
    for (const provider of LLM_PROVIDERS) {
      expect(ids.has(provider.id)).toBe(false)
      ids.add(provider.id)
      expect(provider.models.length).toBeGreaterThan(0)
      expect(provider.models.some((model) => model.id === provider.defaultModel)).toBe(true)
      expect(provider.baseUrl).toMatch(/^https?:\/\//)
      expect(provider.protocol).toBe(provider.id === 'anthropic' ? 'anthropic' : 'openai')
    }
  })

  it('looks up providers and models', () => {
    expect(findLlmProvider('anthropic')?.name).toBe('Anthropic')
    expect(findLlmProvider('nope')).toBeNull()
    expect(findLlmModel('openai', 'gpt-5.6-sol')?.label).toBe('GPT-5.6 Sol')
    expect(findLlmModel('openai', 'nope')).toBeNull()
  })
})
