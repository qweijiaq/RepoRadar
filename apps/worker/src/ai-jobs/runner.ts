import {
  addNotification,
  assertAiQuota,
  assertJobQuota,
  createJob,
  failJob,
  finishJob,
  getJob,
  isJobCancelled,
  isQuotaError,
  jobUsesAi,
  markJobCancelled,
  markJobRunning,
  requeueJob,
  promptVersionForJob,
  recordLlmUsageRows,
  SCORING_VERSION,
  withLlmUsage,
  type DbPool,
  type JobKind,
  type JobPayload,
  type NewJob,
} from '@repo-radar/core'
import { runJobHandler } from './handlers.js'

const JOB_TIMEOUT_MS = 10 * 60 * 1000
const MAX_CONCURRENT_PER_USER = 2
const activeByUser = new Map<number, number>()

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function acquireUserSlot(userId: number): Promise<void> {
  while ((activeByUser.get(userId) ?? 0) >= MAX_CONCURRENT_PER_USER) {
    await sleep(1000)
  }
  activeByUser.set(userId, (activeByUser.get(userId) ?? 0) + 1)
}

function releaseUserSlot(userId: number): void {
  const next = Math.max(0, (activeByUser.get(userId) ?? 1) - 1)
  if (next === 0) activeByUser.delete(userId)
  else activeByUser.set(userId, next)
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('任务执行超时（10 分钟）')), JOB_TIMEOUT_MS)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

async function executeJob(pool: DbPool, userId: number, jobId: number): Promise<void> {
  const job = await getJob(pool, userId, jobId)
  if (!job || job.status !== 'queued') return

  if (jobUsesAi(job.kind)) {
    try {
      await assertAiQuota(pool, userId)
    } catch (error) {
      if (isQuotaError(error)) {
        await failJob(pool, jobId, error.message)
        await addNotification(pool, userId, {
          kind: 'job',
          title: `任务未执行：${job.title}`,
          body: error.message,
          url: '/tasks',
        })
        return
      }
      throw error
    }
  }

  await acquireUserSlot(userId)
  try {
    const started = await markJobRunning(pool, jobId, '准备中…')
    if (!started) return

    try {
      const result = await withTimeout(
        withLlmUsage(
          () => runJobHandler(pool, job, userId),
          (usage) => recordLlmUsageRows(pool, userId, jobId, job.kind, usage),
          { promptVersion: promptVersionForJob(job.kind), scoreVersion: SCORING_VERSION },
        ),
      )
      if (await isJobCancelled(pool, jobId)) {
        await markJobCancelled(pool, jobId)
        return
      }
      await finishJob(pool, jobId, result)
    } catch (error) {
      if (await isJobCancelled(pool, jobId)) {
        await markJobCancelled(pool, jobId)
        return
      }

      const latest = await getJob(pool, userId, jobId)
      const message = error instanceof Error ? error.message : '未知错误'
      if (latest && latest.attempts < latest.maxAttempts) {
        await requeueJob(pool, jobId)
        setTimeout(() => {
          void executeJob(pool, userId, jobId)
        }, 1500)
        return
      }

      console.error(`[jobs] ${job.kind} 任务失败：`, error)
      await failJob(pool, jobId, message)
      await addNotification(pool, userId, {
        kind: 'job',
        title: `任务失败：${job.title}`,
        body: message,
        url: '/tasks',
      })
    }
  } finally {
    releaseUserSlot(userId)
  }
}

/**
 * 创建任务并在响应结束后执行，调用方不需要等待 AI 完成。
 */
export async function enqueueJob(
  pool: DbPool,
  input: {
    userId: number
    kind: JobKind
    title: string
    payload: JobPayload
  },
): Promise<number> {
  const job: NewJob = input
  await assertJobQuota(pool, input.userId, input.kind)
  if (jobUsesAi(input.kind)) await assertAiQuota(pool, input.userId)
  const id = await createJob(pool, job)
  if (process.env.RADAR_INLINE_JOBS !== '0') {
    setTimeout(() => {
      void executeJob(pool, input.userId, id)
    }, 0)
  }
  return id
}

/** 手动重试一个失败/取消的任务。 */
export async function resumeJob(pool: DbPool, userId: number, jobId: number): Promise<void> {
  const job = await getJob(pool, userId, jobId)
  if (!job || (job.status !== 'failed' && job.status !== 'cancelled')) return
  if (jobUsesAi(job.kind)) await assertAiQuota(pool, userId)
  const { retryJob } = await import('@repo-radar/core')
  await retryJob(pool, jobId)
  setTimeout(() => {
    void executeJob(pool, userId, jobId)
  }, 0)
}

export { executeJob }
