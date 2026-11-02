import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { DbPool } from '../../src/db.js'
import { loadJobFailureReasons, loadJobKindMetrics } from '../../src/job-metrics.js'
import { recordLlmUsageRows } from '../../src/usage.js'
import { ensureUser } from '../../src/users.js'
import { createTestPool, dropTestDatabase, hasTestDatabase, truncateAll } from './setup.js'

describe.skipIf(!hasTestDatabase)('job metrics', () => {
  let pool: DbPool | undefined
  let userId = 0

  beforeAll(async () => {
    pool = await createTestPool()
  })

  afterAll(async () => {
    await pool?.end()
    await dropTestDatabase()
  })

  beforeEach(async () => {
    if (!pool) return
    await truncateAll(pool)
    userId = await ensureUser(pool, {
      login: 'metrics-user',
      displayName: 'Metrics User',
      avatarUrl: null,
      githubId: 9101,
    })
  })

  it('按 kind 聚合成功率、耗时和 token', async () => {
    if (!pool) throw new Error('pool 未初始化')
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO ai_jobs (user_id, kind, title, status, payload, started_at, finished_at)
       VALUES ($1, 'integration-trial', 'ok', 'succeeded', '{}'::jsonb, now() - interval '10 seconds', now()),
              ($1, 'integration-trial', 'bad', 'failed', '{}'::jsonb, now() - interval '20 seconds', now()),
              ($1, 'comparison', 'ok', 'succeeded', '{}'::jsonb, now() - interval '4 seconds', now())
       RETURNING id`,
      [userId],
    )
    await recordLlmUsageRows(pool, userId, Number(rows[0]!.id), 'integration-trial', [
      { providerId: null, model: 'test-model', promptTokens: 120, completionTokens: 30, latencyMs: 900 },
    ])

    const metrics = await loadJobKindMetrics(pool, 30)
    const trial = metrics.find((item) => item.kind === 'integration-trial')
    expect(trial).toMatchObject({ total: 2, succeeded: 1, failed: 1, promptTokens: 120, completionTokens: 30 })
    expect(trial?.successRate).toBeCloseTo(0.5)
    expect(trial?.avgSeconds).toBeGreaterThan(0)
    expect(trial?.p95Seconds).toBeGreaterThan(0)

    const comparison = metrics.find((item) => item.kind === 'comparison')
    expect(comparison).toMatchObject({ total: 1, succeeded: 1, promptTokens: 0 })
    expect(comparison?.successRate).toBe(1)
  })

  it('聚合失败原因并按次数排序', async () => {
    if (!pool) throw new Error('pool 未初始化')
    await pool.query(
      `INSERT INTO ai_jobs (user_id, kind, title, status, payload, error)
       VALUES ($1, 'swap-trial', 'a', 'failed', '{}'::jsonb, '模型超时'),
              ($1, 'swap-trial', 'b', 'failed', '{}'::jsonb, '模型超时'),
              ($1, 'comparison', 'c', 'failed', '{}'::jsonb, 'JSON 解析失败')`,
      [userId],
    )
    const reasons = await loadJobFailureReasons(pool, 30, 5)
    expect(reasons[0]).toMatchObject({ kind: 'swap-trial', error: '模型超时', count: 2 })
    expect(reasons).toHaveLength(2)
  })
})
