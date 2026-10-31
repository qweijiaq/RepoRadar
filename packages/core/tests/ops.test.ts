import { describe, expect, it } from 'vitest'
import { DEFAULT_OPS_CONFIG, normalizeOpsConfig, renderPrometheus } from '../src/ops.js'

describe('normalizeOpsConfig', () => {
  it('uses defaults and trims alert emails', () => {
    expect(normalizeOpsConfig(null)).toEqual(DEFAULT_OPS_CONFIG)
    const config = normalizeOpsConfig({ alertEmails: '  ops@example.com, dev@example.com  ' })
    expect(config.alertEmails).toBe('ops@example.com, dev@example.com')
  })

  it('clamps thresholds', () => {
    const config = normalizeOpsConfig({
      failedJobsThreshold: -2,
      queueAgeMinutes: 999999,
      cooldownMinutes: 0,
    })
    expect(config.failedJobsThreshold).toBe(0)
    expect(config.queueAgeMinutes).toBe(10080)
    expect(config.cooldownMinutes).toBe(0)
  })
})

describe('renderPrometheus', () => {
  it('renders job, delivery and token metrics', () => {
    const text = renderPrometheus({
      users: 2,
      jobsQueued: 1,
      jobsRunning: 2,
      jobsFailed24h: 3,
      jobsSucceeded24h: 4,
      jobsFailed15m: 0,
      staleRunningJobs: 0,
      deliveriesPending: 5,
      deliveriesSent24h: 6,
      deliveriesFailed24h: 7,
      deliveriesFailed15m: 0,
      oldestPendingSeconds: 30,
      llmCallsToday: 8,
      llmTokensToday: 900,
      globalTokensToday: 900,
      dbSizeBytes: 1024,
      uptimeSeconds: 60,
    })
    expect(text).toContain('reporadar_users_total 2')
    expect(text).toContain('reporadar_jobs{status="queued"} 1')
    expect(text).toContain('reporadar_oldest_pending_delivery_seconds 30')
    expect(text).toContain('reporadar_process_uptime_seconds 60')
  })
})
