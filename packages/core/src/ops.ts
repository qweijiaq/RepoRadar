import type { DbPool } from './db.js'
import { findUserById } from './users.js'
import { resolveNotificationEmail } from './users.js'

const CONFIG_KEY = 'ops.config'

export interface OpsConfig {
  alertsEnabled: boolean
  alertEmails: string
  failedJobsThreshold: number
  failedDeliveriesThreshold: number
  queueAgeMinutes: number
  cooldownMinutes: number
}

export const DEFAULT_OPS_CONFIG: OpsConfig = {
  alertsEnabled: true,
  alertEmails: '',
  failedJobsThreshold: 3,
  failedDeliveriesThreshold: 3,
  queueAgeMinutes: 60,
  cooldownMinutes: 60,
}

export interface OpsMetrics {
  users: number
  jobsQueued: number
  jobsRunning: number
  jobsFailed24h: number
  jobsSucceeded24h: number
  jobsFailed15m: number
  staleRunningJobs: number
  deliveriesPending: number
  deliveriesSent24h: number
  deliveriesFailed24h: number
  deliveriesFailed15m: number
  oldestPendingSeconds: number
  llmCallsToday: number
  llmTokensToday: number
  globalTokensToday: number
  dbSizeBytes: number
}

export interface OpsFailureJob {
  id: number
  kind: string
  title: string
  error: string | null
  finishedAt: string | null
}

export interface OpsFailureDelivery {
  id: number
  channel: string
  subject: string
  attempts: number
  lastError: string | null
  createdAt: string
}

export interface OpsAlert {
  key: string
  severity: 'warning' | 'critical'
  title: string
  body: string
}

function clamp(value: unknown, fallback: number, max: number): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(0, Math.min(max, Math.floor(number)))
}

export function normalizeOpsConfig(input: Partial<OpsConfig> | null | undefined): OpsConfig {
  return {
    alertsEnabled: input?.alertsEnabled !== false,
    alertEmails: typeof input?.alertEmails === 'string' ? input.alertEmails.trim().slice(0, 2000) : '',
    failedJobsThreshold: clamp(input?.failedJobsThreshold, DEFAULT_OPS_CONFIG.failedJobsThreshold, 1000),
    failedDeliveriesThreshold: clamp(
      input?.failedDeliveriesThreshold,
      DEFAULT_OPS_CONFIG.failedDeliveriesThreshold,
      1000,
    ),
    queueAgeMinutes: clamp(input?.queueAgeMinutes, DEFAULT_OPS_CONFIG.queueAgeMinutes, 10080),
    cooldownMinutes: clamp(input?.cooldownMinutes, DEFAULT_OPS_CONFIG.cooldownMinutes, 1440),
  }
}

export async function loadOpsConfig(pool: DbPool): Promise<OpsConfig> {
  try {
    const { rows } = await pool.query<{ value: Partial<OpsConfig> }>(
      `SELECT value FROM app_settings WHERE key = $1`,
      [CONFIG_KEY],
    )
    return normalizeOpsConfig(rows[0]?.value)
  } catch {
    return DEFAULT_OPS_CONFIG
  }
}

export async function saveOpsConfig(pool: DbPool, input: Partial<OpsConfig>): Promise<OpsConfig> {
  const config = normalizeOpsConfig(input)
  await pool.query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [CONFIG_KEY, JSON.stringify(config)],
  )
  return config
}

export async function clearOpsConfig(pool: DbPool): Promise<void> {
  await pool.query(`DELETE FROM app_settings WHERE key = $1`, [CONFIG_KEY])
}

export async function loadOpsMetrics(pool: DbPool): Promise<OpsMetrics> {
  const [jobs, deliveries, usage, size, users] = await Promise.all([
    pool.query<{
      queued: string
      running: string
      failed24h: string
      succeeded24h: string
      failed15m: string
      stale: string
    }>(
      `SELECT
         count(*) FILTER (WHERE status = 'queued') AS queued,
         count(*) FILTER (WHERE status = 'running') AS running,
         count(*) FILTER (WHERE status = 'failed' AND finished_at >= now() - INTERVAL '24 hours') AS failed24h,
         count(*) FILTER (WHERE status = 'succeeded' AND finished_at >= now() - INTERVAL '24 hours') AS succeeded24h,
         count(*) FILTER (WHERE status = 'failed' AND finished_at >= now() - INTERVAL '15 minutes') AS failed15m,
         count(*) FILTER (WHERE status = 'running' AND heartbeat_at < now() - INTERVAL '10 minutes') AS stale
       FROM ai_jobs`,
    ),
    pool.query<{
      pending: string
      sent24h: string
      failed24h: string
      failed15m: string
      oldest_seconds: string
    }>(
      `SELECT
         count(*) FILTER (WHERE status = 'queued') AS pending,
         count(*) FILTER (WHERE status = 'sent' AND sent_at >= now() - INTERVAL '24 hours') AS sent24h,
         count(*) FILTER (WHERE status = 'failed' AND created_at >= now() - INTERVAL '24 hours') AS failed24h,
         count(*) FILTER (WHERE status = 'failed' AND created_at >= now() - INTERVAL '15 minutes') AS failed15m,
         COALESCE(EXTRACT(EPOCH FROM now() - min(created_at) FILTER (WHERE status = 'queued')), 0) AS oldest_seconds
       FROM delivery_queue`,
    ),
    pool.query<{ calls: string; tokens: string; global_tokens: string }>(
      `SELECT
         count(*) FILTER (WHERE user_id IS NOT NULL) AS calls,
         COALESCE(sum(prompt_tokens + completion_tokens), 0) AS tokens,
         COALESCE(sum(prompt_tokens + completion_tokens), 0) AS global_tokens
       FROM llm_usage WHERE created_at >= date_trunc('day', now())`,
    ),
    pool.query<{ bytes: string }>(`SELECT pg_database_size(current_database()) AS bytes`),
    pool.query<{ count: string }>(`SELECT count(*) FROM users`),
  ])
  const job = jobs.rows[0]
  const delivery = deliveries.rows[0]
  const usageRow = usage.rows[0]
  return {
    users: Number(users.rows[0]?.count ?? 0),
    jobsQueued: Number(job?.queued ?? 0),
    jobsRunning: Number(job?.running ?? 0),
    jobsFailed24h: Number(job?.failed24h ?? 0),
    jobsSucceeded24h: Number(job?.succeeded24h ?? 0),
    jobsFailed15m: Number(job?.failed15m ?? 0),
    staleRunningJobs: Number(job?.stale ?? 0),
    deliveriesPending: Number(delivery?.pending ?? 0),
    deliveriesSent24h: Number(delivery?.sent24h ?? 0),
    deliveriesFailed24h: Number(delivery?.failed24h ?? 0),
    deliveriesFailed15m: Number(delivery?.failed15m ?? 0),
    oldestPendingSeconds: Math.round(Number(delivery?.oldest_seconds ?? 0)),
    llmCallsToday: Number(usageRow?.calls ?? 0),
    llmTokensToday: Number(usageRow?.tokens ?? 0),
    globalTokensToday: Number(usageRow?.global_tokens ?? 0),
    dbSizeBytes: Number(size.rows[0]?.bytes ?? 0),
  }
}

export async function loadRecentFailures(pool: DbPool): Promise<{
  jobs: OpsFailureJob[]
  deliveries: OpsFailureDelivery[]
}> {
  const [jobs, deliveries] = await Promise.all([
    pool.query<{
      id: string
      kind: string
      title: string
      error: string | null
      finished_at: Date | string | null
    }>(
      `SELECT id, kind, title, error, finished_at FROM ai_jobs
       WHERE status = 'failed' ORDER BY finished_at DESC NULLS LAST LIMIT 10`,
    ),
    pool.query<{
      id: string
      channel: string
      subject: string
      attempts: number
      last_error: string | null
      created_at: Date | string
    }>(
      `SELECT id, channel, subject, attempts, last_error, created_at FROM delivery_queue
       WHERE status = 'failed' ORDER BY created_at DESC LIMIT 10`,
    ),
  ])
  return {
    jobs: jobs.rows.map((row) => ({
      id: Number(row.id),
      kind: row.kind,
      title: row.title,
      error: row.error,
      finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : null,
    })),
    deliveries: deliveries.rows.map((row) => ({
      id: Number(row.id),
      channel: row.channel,
      subject: row.subject,
      attempts: row.attempts,
      lastError: row.last_error,
      createdAt: new Date(row.created_at).toISOString(),
    })),
  }
}

export function renderPrometheus(metrics: OpsMetrics & { uptimeSeconds?: number }): string {
  const lines = [
    '# HELP reporadar_users_total Number of registered users',
    '# TYPE reporadar_users_total gauge',
    `reporadar_users_total ${metrics.users}`,
    '# HELP reporadar_jobs Number of jobs by status',
    '# TYPE reporadar_jobs gauge',
    `reporadar_jobs{status="queued"} ${metrics.jobsQueued}`,
    `reporadar_jobs{status="running"} ${metrics.jobsRunning}`,
    `reporadar_jobs{status="failed_24h"} ${metrics.jobsFailed24h}`,
    `reporadar_jobs{status="succeeded_24h"} ${metrics.jobsSucceeded24h}`,
    `reporadar_jobs{status="stale_running"} ${metrics.staleRunningJobs}`,
    '# HELP reporadar_deliveries Number of deliveries by status',
    '# TYPE reporadar_deliveries gauge',
    `reporadar_deliveries{status="pending"} ${metrics.deliveriesPending}`,
    `reporadar_deliveries{status="sent_24h"} ${metrics.deliveriesSent24h}`,
    `reporadar_deliveries{status="failed_24h"} ${metrics.deliveriesFailed24h}`,
    '# HELP reporadar_oldest_pending_delivery_seconds Age of the oldest queued delivery',
    '# TYPE reporadar_oldest_pending_delivery_seconds gauge',
    `reporadar_oldest_pending_delivery_seconds ${metrics.oldestPendingSeconds}`,
    '# HELP reporadar_llm_tokens_today Tokens used today',
    '# TYPE reporadar_llm_tokens_today gauge',
    `reporadar_llm_tokens_today ${metrics.llmTokensToday}`,
    '# HELP reporadar_llm_calls_today LLM calls recorded today',
    '# TYPE reporadar_llm_calls_today gauge',
    `reporadar_llm_calls_today ${metrics.llmCallsToday}`,
    '# HELP reporadar_database_size_bytes PostgreSQL database size',
    '# TYPE reporadar_database_size_bytes gauge',
    `reporadar_database_size_bytes ${metrics.dbSizeBytes}`,
  ]
  if (typeof metrics.uptimeSeconds === 'number') {
    lines.push(
      '# HELP reporadar_process_uptime_seconds Web process uptime',
      '# TYPE reporadar_process_uptime_seconds gauge',
      `reporadar_process_uptime_seconds ${metrics.uptimeSeconds}`,
    )
  }
  return `${lines.join('\n')}\n`
}

export async function evaluateAlerts(pool: DbPool): Promise<OpsAlert[]> {
  const config = await loadOpsConfig(pool)
  if (!config.alertsEnabled) return []
  const metrics = await loadOpsMetrics(pool)
  const alerts: OpsAlert[] = []
  if (config.failedJobsThreshold > 0 && metrics.jobsFailed15m >= config.failedJobsThreshold) {
    alerts.push({
      key: 'failed-jobs',
      severity: 'warning',
      title: '任务失败数异常',
      body: `过去 15 分钟有 ${metrics.jobsFailed15m} 个任务失败（阈值 ${config.failedJobsThreshold}）。打开 /ops 查看错误。`,
    })
  }
  if (
    config.failedDeliveriesThreshold > 0 &&
    metrics.deliveriesFailed15m >= config.failedDeliveriesThreshold
  ) {
    alerts.push({
      key: 'failed-deliveries',
      severity: 'warning',
      title: '通知投递失败数异常',
      body: `过去 15 分钟有 ${metrics.deliveriesFailed15m} 条投递失败（阈值 ${config.failedDeliveriesThreshold}）。请检查 SMTP/推送配置和 /ops。`,
    })
  }
  if (config.queueAgeMinutes > 0 && metrics.oldestPendingSeconds >= config.queueAgeMinutes * 60) {
    alerts.push({
      key: 'queue-age',
      severity: 'critical',
      title: '投递队列积压',
      body: `最老的待投递消息已等待 ${Math.round(metrics.oldestPendingSeconds / 60)} 分钟（阈值 ${config.queueAgeMinutes} 分钟）。请检查 worker 与邮件通道。`,
    })
  }
  if (metrics.staleRunningJobs > 0) {
    alerts.push({
      key: 'stale-jobs',
      severity: 'critical',
      title: '存在心跳超时的运行任务',
      body: `有 ${metrics.staleRunningJobs} 个任务超过 10 分钟没有心跳，可能 worker 已停止。`,
    })
  }
  return alerts
}

export async function alertRecipients(pool: DbPool): Promise<string[]> {
  const config = await loadOpsConfig(pool)
  const configured = (config.alertEmails || process.env.ALERT_EMAILS || '')
    .split(/[,\s]+/)
    .map((email) => email.trim())
    .filter(Boolean)
  if (configured.length > 0) return [...new Set(configured)]

  const admins = (process.env.ADMIN_LOGINS ?? '')
    .split(/[,\s]+/)
    .map((login) => login.trim().replace(/^@/, '').toLowerCase())
    .filter(Boolean)
  const rows = admins.length > 0
    ? await pool.query<{ id: string }>(`SELECT id FROM users WHERE lower(login) = ANY($1::text[])`, [admins])
    : await pool.query<{ id: string }>(`SELECT id FROM users ORDER BY id LIMIT 1`)
  const emails: string[] = []
  for (const row of rows.rows) {
    const user = await findUserById(pool, Number(row.id))
    const email = resolveNotificationEmail(user)
    if (email) emails.push(email)
  }
  return [...new Set(emails)]
}

export async function claimAlert(pool: DbPool, key: string, cooldownMinutes: number): Promise<boolean> {
  const minutes = Math.max(1, cooldownMinutes)
  const { rowCount } = await pool.query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
     WHERE app_settings.updated_at < now() - make_interval(mins => $3)`,
    [`ops.alert.${key}`, JSON.stringify({ at: new Date().toISOString() }), minutes],
  )
  return (rowCount ?? 0) > 0
}

export async function loadAlertLog(pool: DbPool): Promise<Array<{ key: string; at: string }>> {
  const { rows } = await pool.query<{ key: string; value: { at?: string } }>(
    `SELECT key, value FROM app_settings WHERE key LIKE 'ops.alert.%' ORDER BY updated_at DESC LIMIT 20`,
  )
  return rows
    .filter((row) => typeof row.value?.at === 'string')
    .map((row) => ({ key: row.key.replace(/^ops\.alert\./, ''), at: row.value.at! }))
}
