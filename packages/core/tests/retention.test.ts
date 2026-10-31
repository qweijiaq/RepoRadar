import { describe, expect, it } from 'vitest'
import { DEFAULT_RETENTION_CONFIG, normalizeRetentionConfig } from '../src/retention.js'

describe('normalizeRetentionConfig', () => {
  it('uses defaults when empty', () => {
    expect(normalizeRetentionConfig(null)).toEqual(DEFAULT_RETENTION_CONFIG)
  })

  it('keeps zero as keep forever and clamps invalid values', () => {
    const config = normalizeRetentionConfig({ notificationsDays: -1, deliveryQueueDays: 0, llmUsageDays: 99999 })
    expect(config.notificationsDays).toBe(0)
    expect(config.deliveryQueueDays).toBe(0)
    expect(config.llmUsageDays).toBe(3650)
  })

  it('defaults generated content and copilot to keep forever', () => {
    expect(DEFAULT_RETENTION_CONFIG.copilotDays).toBe(0)
    expect(DEFAULT_RETENTION_CONFIG.generatedContentDays).toBe(0)
  })
})
