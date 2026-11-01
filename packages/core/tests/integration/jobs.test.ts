import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { DbPool } from '../../src/db.js'
import {
  cancelJob,
  countActiveJobs,
  createJob,
  failJob,
  finishJob,
  getJob,
  isJobCancelled,
  listJobs,
  listQueuedJobs,
  markJobCancelled,
  markJobRunning,
  recoverStaleJobs,
} from '../../src/jobs.js'
import { ensureUser } from '../../src/users.js'
import { createTestPool, dropTestDatabase, hasTestDatabase, truncateAll } from './setup.js'

describe.skipIf(!hasTestDatabase)('job queue integration', () => {
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
      login: 'queue-user',
      displayName: 'Queue User',
      avatarUrl: null,
      githubId: 9001,
    })
  })

  it('同一任务只会被一个 worker 领到', async () => {
    if (!pool) throw new Error('pool 未初始化')
    const jobId = await createJob(pool, {
      userId,
      kind: 'enrich',
      title: '富化 acme/radar',
      payload: { repo: 'acme/radar' },
    })

    expect(await listQueuedJobs(pool, 5)).toEqual([{ id: jobId, userId }])

    const claimed = await markJobRunning(pool, jobId, '准备中')
    expect(claimed).toEqual({ attempts: 1, maxAttempts: 2 })

    // 第二个 worker 再领同一个任务会拿到 null，不会重复执行。
    expect(await markJobRunning(pool, jobId)).toBeNull()
    expect((await getJob(pool, userId, jobId))?.status).toBe('running')
  })

  it('取消请求会立即生效，运行中的任务保留 running 状态', async () => {
    if (!pool) throw new Error('pool 未初始化')
    const jobId = await createJob(pool, { userId, kind: 'issue', title: '生成 Issue', payload: {} })
    await markJobRunning(pool, jobId)

    await cancelJob(pool, jobId)
    expect(await isJobCancelled(pool, jobId)).toBe(true)
    const running = await getJob(pool, userId, jobId)
    expect(running?.status).toBe('running')
    expect(running?.cancelRequested).toBe(true)

    await markJobCancelled(pool, jobId)
    expect((await getJob(pool, userId, jobId))?.status).toBe('cancelled')
  })

  it('完成任务会写入结果并从队列里移除', async () => {
    if (!pool) throw new Error('pool 未初始化')
    const jobId = await createJob(pool, { userId, kind: 'enrich', title: '富化', payload: {} })
    await markJobRunning(pool, jobId)
    await finishJob(pool, jobId, { href: '/r/acme/radar', label: '查看报告' })

    const job = await getJob(pool, userId, jobId)
    expect(job?.status).toBe('succeeded')
    expect(job?.result).toEqual({ href: '/r/acme/radar', label: '查看报告' })
    expect(await listQueuedJobs(pool, 5)).toEqual([])
  })

  it('心跳超时的运行中任务会被回收为 failed', async () => {
    if (!pool) throw new Error('pool 未初始化')
    const jobId = await createJob(pool, { userId, kind: 'patch', title: '验证补丁', payload: {} })
    await markJobRunning(pool, jobId)
    await pool.query(
      `UPDATE ai_jobs SET heartbeat_at = now() - INTERVAL '16 minutes' WHERE id = $1`,
      [jobId],
    )

    expect(await recoverStaleJobs(pool)).toBe(1)
    const job = await getJob(pool, userId, jobId)
    expect(job?.status).toBe('failed')
    expect(job?.error).toContain('心跳超时')
  })

  it('刚过执行超时但未超过回收阈值的任务不会被误判', async () => {
    if (!pool) throw new Error('pool 未初始化')
    const jobId = await createJob(pool, { userId, kind: 'patch', title: '长时间验证', payload: {} })
    await markJobRunning(pool, jobId)
    // 12 分钟 > runner 的 10 分钟超时，但 < 15 分钟回收阈值。
    await pool.query(
      `UPDATE ai_jobs SET heartbeat_at = now() - INTERVAL '12 minutes' WHERE id = $1`,
      [jobId],
    )

    expect(await recoverStaleJobs(pool)).toBe(0)
    expect((await getJob(pool, userId, jobId))?.status).toBe('running')
  })

  it('迟到的完成结果不会覆盖已被回收的任务', async () => {
    if (!pool) throw new Error('pool 未初始化')
    const jobId = await createJob(pool, { userId, kind: 'enrich', title: '富化', payload: {} })
    await markJobRunning(pool, jobId)
    await pool.query(
      `UPDATE ai_jobs SET heartbeat_at = now() - INTERVAL '16 minutes' WHERE id = $1`,
      [jobId],
    )
    await recoverStaleJobs(pool)

    await finishJob(pool, jobId, { href: '/r/acme/radar', label: '迟到结果' })
    const job = await getJob(pool, userId, jobId)
    expect(job?.status).toBe('failed')
    expect(job?.result).toBeNull()
  })

  it('已完成的任务不会被迟到的失败覆盖', async () => {
    if (!pool) throw new Error('pool 未初始化')
    const jobId = await createJob(pool, { userId, kind: 'enrich', title: '富化', payload: {} })
    await markJobRunning(pool, jobId)
    await finishJob(pool, jobId, { href: '/r/acme/radar', label: '完成' })

    await failJob(pool, jobId, '迟到的失败')
    const job = await getJob(pool, userId, jobId)
    expect(job?.status).toBe('succeeded')
    expect(job?.result).toEqual({ href: '/r/acme/radar', label: '完成' })
  })

  it('排队中的任务可以直接失败（配额检查路径）', async () => {
    if (!pool) throw new Error('pool 未初始化')
    const jobId = await createJob(pool, { userId, kind: 'enrich', title: '富化', payload: {} })

    await failJob(pool, jobId, 'AI 配额已用完')
    const job = await getJob(pool, userId, jobId)
    expect(job?.status).toBe('failed')
    expect(job?.error).toBe('AI 配额已用完')
  })

  it('listJobs 支持状态过滤，countActiveJobs 只统计排队和运行中', async () => {
    if (!pool) throw new Error('pool 未初始化')
    const queued = await createJob(pool, { userId, kind: 'enrich', title: '排队中', payload: {} })
    const running = await createJob(pool, { userId, kind: 'watch', title: '运行中', payload: {} })
    await markJobRunning(pool, running)
    const failed = await createJob(pool, { userId, kind: 'patch', title: '已失败', payload: {} })
    await pool.query(`UPDATE ai_jobs SET status = 'failed' WHERE id = $1`, [failed])

    expect(await countActiveJobs(pool, userId)).toBe(2)

    const failedJobs = await listJobs(pool, userId, 10, { status: 'failed' })
    expect(failedJobs.map((job) => job.id)).toEqual([failed])
    expect([queued, running]).toHaveLength(2)
  })
})
