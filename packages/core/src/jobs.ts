import type { DbPool } from './db.js'
import type { EncryptedBox } from './secret-box.js'

export type JobKind =
  | 'integration'
  | 'maintainer'
  | 'issue'
  | 'discoverability'
  | 'comparison'
  | 'issue-plan'
  | 'watch'
  | 'activity'
  | 'patch'
  | 'upgrade'
  | 'discover'
  | 'enrich'
  | 'similar'

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export interface JobPayload {
  focus?: string
  token?: EncryptedBox | null
  origin?: string
  project?: string
  projects?: string[]
  candidates?: string[]
  repo?: string
  issueNumber?: number
  intentId?: number
  packageName?: string
  topics?: string[]
  enrichLimit?: number
  targetVersion?: string
  currentVersion?: string
  manifestPath?: string
}

export interface JobResult {
  href: string
  label: string
}

export interface JobRecord {
  id: number
  kind: JobKind
  title: string
  status: JobStatus
  payload: JobPayload
  result: JobResult | null
  error: string | null
  progress: string | null
  attempts: number
  maxAttempts: number
  cancelRequested: boolean
  heartbeatAt: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

export interface NewJob {
  userId: number
  kind: JobKind
  title: string
  payload: JobPayload
}

interface JobRow {
  id: string
  kind: JobKind
  title: string
  status: JobStatus
  payload: JobPayload | null
  result: JobResult | null
  error: string | null
  progress: string | null
  attempts: number
  max_attempts: number
  cancel_requested: boolean
  heartbeat_at: Date | string | null
  created_at: Date | string
  started_at: Date | string | null
  finished_at: Date | string | null
}

function iso(value: Date | string | null): string | null {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : value
}

function mapJob(row: JobRow): JobRecord {
  return {
    id: Number(row.id),
    kind: row.kind,
    title: row.title,
    status: row.status,
    payload: row.payload ?? {},
    result: row.result ?? null,
    error: row.error,
    progress: row.progress,
    attempts: row.attempts ?? 0,
    maxAttempts: row.max_attempts ?? 2,
    cancelRequested: row.cancel_requested ?? false,
    heartbeatAt: iso(row.heartbeat_at),
    createdAt: iso(row.created_at) ?? new Date().toISOString(),
    startedAt: iso(row.started_at),
    finishedAt: iso(row.finished_at),
  }
}

export async function createJob(pool: DbPool, input: NewJob): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO ai_jobs (user_id, kind, title, payload, status)
     VALUES ($1, $2, $3, $4, 'queued') RETURNING id`,
    [input.userId, input.kind, input.title, JSON.stringify(input.payload)],
  )
  return Number(rows[0]?.id ?? 0)
}

export async function markJobRunning(
  pool: DbPool,
  id: number,
  progress: string | null = null,
): Promise<{ attempts: number; maxAttempts: number } | null> {
  const { rows } = await pool.query<{ attempts: number; max_attempts: number }>(
    `UPDATE ai_jobs SET status = 'running', started_at = COALESCE(started_at, now()),
       heartbeat_at = now(), attempts = attempts + 1, progress = $2
     WHERE id = $1 AND status = 'queued' AND cancel_requested = FALSE
     RETURNING attempts, max_attempts`,
    [id, progress],
  )
  const row = rows[0]
  return row ? { attempts: row.attempts, maxAttempts: row.max_attempts } : null
}

export async function updateJobProgress(pool: DbPool, id: number, progress: string): Promise<void> {
  await pool.query(
    `UPDATE ai_jobs SET progress = $2, heartbeat_at = now() WHERE id = $1 AND status = 'running'`,
    [id, progress],
  )
}

export async function isJobCancelled(pool: DbPool, id: number): Promise<boolean> {
  const { rows } = await pool.query<{ cancel_requested: boolean; status: JobStatus }>(
    `SELECT cancel_requested, status FROM ai_jobs WHERE id = $1`,
    [id],
  )
  return !rows[0] || rows[0].cancel_requested || rows[0].status === 'cancelled'
}

export async function cancelJob(pool: DbPool, id: number): Promise<void> {
  await pool.query(
    `UPDATE ai_jobs SET
       cancel_requested = TRUE,
       status = CASE WHEN status = 'queued' THEN 'cancelled' ELSE status END,
       progress = CASE WHEN status = 'queued' THEN NULL ELSE progress END,
       finished_at = CASE WHEN status = 'queued' THEN now() ELSE finished_at END
     WHERE id = $1 AND status IN ('queued', 'running')`,
    [id],
  )
}

export async function markJobCancelled(pool: DbPool, id: number): Promise<void> {
  await pool.query(
    `UPDATE ai_jobs SET status = 'cancelled', progress = NULL, finished_at = now()
     WHERE id = $1 AND status IN ('queued', 'running')`,
    [id],
  )
}

export async function requeueJob(pool: DbPool, id: number): Promise<void> {
  await pool.query(
    `UPDATE ai_jobs SET status = 'queued', error = NULL, progress = '等待自动重试…',
       heartbeat_at = NULL, finished_at = NULL
     WHERE id = $1 AND status IN ('failed', 'running') AND cancel_requested = FALSE`,
    [id],
  )
}

export async function retryJob(pool: DbPool, id: number): Promise<void> {
  await pool.query(
    `UPDATE ai_jobs SET status = 'queued', cancel_requested = FALSE, attempts = 0,
       error = NULL, progress = '等待重试…', finished_at = NULL, heartbeat_at = NULL
     WHERE id = $1 AND status IN ('failed', 'cancelled')`,
    [id],
  )
}

export async function recoverStaleJobs(pool: DbPool): Promise<number> {
  // 阈值要比 runner 的 10 分钟执行超时更长，否则还在跑的任务会被误判为心跳超时。
  const { rowCount } = await pool.query(
    `UPDATE ai_jobs SET status = 'failed', error = '任务心跳超时，可能服务已重启', finished_at = now()
     WHERE status = 'running' AND heartbeat_at < now() - INTERVAL '15 minutes'`,
  )
  return rowCount ?? 0
}

export async function finishJob(pool: DbPool, id: number, result: JobResult): Promise<void> {
  // 只有仍在运行的任务才能完成；已被回收/取消/重试的任务不能被迟到的结果覆盖。
  await pool.query(
    `UPDATE ai_jobs SET status = 'succeeded', result = $2, progress = NULL, finished_at = now()
     WHERE id = $1 AND status = 'running'`,
    [id, JSON.stringify(result)],
  )
}

export async function failJob(pool: DbPool, id: number, error: string): Promise<void> {
  // 配额检查失败时任务还是 queued，所以这里同时接受 queued 和 running。
  await pool.query(
    `UPDATE ai_jobs SET status = 'failed', error = $2, progress = NULL, finished_at = now()
     WHERE id = $1 AND status IN ('queued', 'running')`,
    [id, error.slice(0, 500)],
  )
}

export async function getJob(pool: DbPool, userId: number, id: number): Promise<JobRecord | null> {
  const { rows } = await pool.query<JobRow>(
    `SELECT id, kind, title, status, payload, result, error, progress, attempts, max_attempts,
            cancel_requested, heartbeat_at, created_at, started_at, finished_at
     FROM ai_jobs WHERE user_id = $1 AND id = $2 LIMIT 1`,
    [userId, id],
  )
  return rows[0] ? mapJob(rows[0]) : null
}

export async function listJobs(
  pool: DbPool,
  userId: number,
  limit = 30,
  options: { offset?: number; status?: JobStatus } = {},
): Promise<JobRecord[]> {
  const params: unknown[] = [userId, limit, Math.max(0, options.offset ?? 0)]
  let statusFilter = ''
  if (options.status) {
    params.push(options.status)
    statusFilter = `AND status = $${params.length}`
  }
  const { rows } = await pool.query<JobRow>(
    `SELECT id, kind, title, status, payload, result, error, progress, attempts, max_attempts,
            cancel_requested, heartbeat_at, created_at, started_at, finished_at
     FROM ai_jobs WHERE user_id = $1 ${statusFilter}
     ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    params,
  )
  return rows.map(mapJob)
}

export async function countActiveJobs(pool: DbPool, userId: number): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT count(*) FROM ai_jobs WHERE user_id = $1 AND status IN ('queued', 'running')`,
    [userId],
  )
  return Number(rows[0]?.count ?? 0)
}

export async function listQueuedJobs(
  pool: DbPool,
  limit = 5,
): Promise<Array<{ id: number; userId: number }>> {
  const { rows } = await pool.query<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM ai_jobs
     WHERE status = 'queued' AND cancel_requested = FALSE
     ORDER BY created_at ASC LIMIT $1`,
    [limit],
  )
  return rows.map((row) => ({ id: Number(row.id), userId: Number(row.user_id) }))
}
