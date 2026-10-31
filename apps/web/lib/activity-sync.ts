import { isQuotaError, type DbPool } from '@repo-radar/core'
import { enqueueJob } from '@/lib/ai-jobs/runner'
import { encryptJobToken } from '@/lib/job-secret'

const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000
const FAILURE_COOLDOWN_MS = 60 * 60 * 1000

/**
 * 进入收件箱时最多每 6 小时自动排一次 GitHub 动态同步。
 * 第一次同步只建立基线，不会把历史 star/fork 全部补发。
 */
export async function maybeQueueActivitySync(
  pool: DbPool,
  userId: number,
  token: string | null,
  options: { minIntervalMs?: number } = {},
): Promise<boolean> {
  if (!token) return false

  const activeProjects = await pool.query<{ count: string }>(
    `SELECT count(*) FROM user_projects WHERE user_id = $1 AND active = TRUE`,
    [userId],
  )
  if (Number(activeProjects.rows[0]?.count ?? 0) === 0) return false

  const activeJob = await pool.query<{ status: string; created_at: Date | string }>(
    `SELECT status, created_at FROM ai_jobs
     WHERE user_id = $1 AND kind = 'activity'
     ORDER BY created_at DESC LIMIT 1`,
    [userId],
  )
  const lastJob = activeJob.rows[0]
  if (lastJob) {
    const age = Date.now() - new Date(lastJob.created_at).getTime()
    if (lastJob.status === 'queued' || lastJob.status === 'running') return false
    if (lastJob.status === 'failed' && age < FAILURE_COOLDOWN_MS) return false
  }

  const state = await pool.query<{ last_synced_at: Date | string | null }>(
    `SELECT max(last_synced_at) AS last_synced_at FROM activity_sync_state WHERE user_id = $1`,
    [userId],
  )
  const lastSynced = state.rows[0]?.last_synced_at
  const minInterval = options.minIntervalMs ?? SYNC_INTERVAL_MS
  if (lastSynced && Date.now() - new Date(lastSynced).getTime() < minInterval) return false

  try {
    await enqueueJob(pool, {
      userId,
      kind: 'activity',
      title: '同步 GitHub 动态',
      payload: { token: encryptJobToken(token), origin: '/inbox' },
    })
    return true
  } catch (error) {
    if (isQuotaError(error)) return false
    throw error
  }
}
