import { describe, expect, it } from 'vitest'
import {
  DEFAULT_QUOTA_CONFIG,
  QuotaError,
  isQuotaError,
  jobUsesAi,
  normalizeQuotaConfig,
} from '../src/quotas.js'

describe('normalizeQuotaConfig', () => {
  it('uses defaults for missing values', () => {
    expect(normalizeQuotaConfig(null)).toEqual(DEFAULT_QUOTA_CONFIG)
  })

  it('clamps negative values to zero and keeps booleans', () => {
    const config = normalizeQuotaConfig({ aiEnabled: false, dailyAiCalls: -5, dailyAiTokens: 1234.9 })
    expect(config.aiEnabled).toBe(false)
    expect(config.dailyAiCalls).toBe(0)
    expect(config.dailyAiTokens).toBe(1234)
  })

  it('treats only explicit false as disabled', () => {
    expect(normalizeQuotaConfig({}).aiEnabled).toBe(true)
    expect(normalizeQuotaConfig({ aiEnabled: false }).aiEnabled).toBe(false)
  })
})

describe('jobUsesAi', () => {
  it('allows activity without AI but marks generation jobs', () => {
    expect(jobUsesAi('activity')).toBe(false)
    expect(jobUsesAi('patch')).toBe(true)
    expect(jobUsesAi('upgrade')).toBe(true)
    expect(jobUsesAi('integration')).toBe(true)
  })
})

describe('QuotaError', () => {
  it('is identifiable without leaking class identity across bundles', () => {
    const error = new QuotaError('daily-ai-calls', 'limit')
    expect(isQuotaError(error)).toBe(true)
    expect(error.code).toBe('daily-ai-calls')
    expect(isQuotaError(new Error('no'))).toBe(false)
  })
})
