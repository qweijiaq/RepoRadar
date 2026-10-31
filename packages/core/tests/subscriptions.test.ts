import { describe, expect, it } from 'vitest'
import {
  computeSubscriptionBonus,
  isValidSubscriptionValue,
  normalizeSubscriptionValue,
} from '../src/subscriptions.js'

const repo = { fullName: 'acme/tool', owner: 'acme', topics: ['llm', 'cli'], language: 'TypeScript' }

describe('normalizeSubscriptionValue', () => {
  it('lowercases topics and trims input', () => {
    expect(normalizeSubscriptionValue('topic', '  LLM ')).toBe('llm')
    expect(normalizeSubscriptionValue('author', ' Acme ')).toBe('Acme')
  })
})

describe('isValidSubscriptionValue', () => {
  it('accepts realistic values', () => {
    expect(isValidSubscriptionValue('topic', 'ai-agents')).toBe(true)
    expect(isValidSubscriptionValue('language', 'C++')).toBe(true)
    expect(isValidSubscriptionValue('author', 'vercel')).toBe(true)
    expect(isValidSubscriptionValue('release', 'langgenius/dify')).toBe(true)
  })

  it('rejects malformed values', () => {
    expect(isValidSubscriptionValue('topic', 'two words')).toBe(false)
    expect(isValidSubscriptionValue('release', 'not-a-repo')).toBe(false)
    expect(isValidSubscriptionValue('topic', '')).toBe(false)
  })
})

describe('computeSubscriptionBonus', () => {
  it('rewards matching topics, languages, authors and watched repos', () => {
    expect(computeSubscriptionBonus(repo, [{ kind: 'topic', value: 'llm' }])).toBe(0.07)
    expect(computeSubscriptionBonus(repo, [{ kind: 'language', value: 'typescript' }])).toBe(0.04)
    expect(computeSubscriptionBonus(repo, [{ kind: 'author', value: 'ACME' }])).toBe(0.1)
    expect(computeSubscriptionBonus(repo, [{ kind: 'release', value: 'acme/tool' }])).toBe(0.05)
  })

  it('caps the total bonus', () => {
    const bonus = computeSubscriptionBonus(repo, [
      { kind: 'topic', value: 'llm' },
      { kind: 'topic', value: 'cli' },
      { kind: 'language', value: 'TypeScript' },
      { kind: 'author', value: 'acme' },
      { kind: 'release', value: 'acme/tool' },
    ])
    expect(bonus).toBeLessThanOrEqual(0.2)
  })

  it('returns 0 without subscriptions', () => {
    expect(computeSubscriptionBonus(repo, [])).toBe(0)
  })
})
