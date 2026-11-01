import type { DbPool } from './db.js'

/**
 * 管理员用的用户概览：注册时间、画像规模、任务与近 30 天 token 用量。
 * 只读，不包含任何凭据。
 */
export interface AdminUserOverview {
  id: number
  login: string
  name: string | null
  email: string | null
  notificationEmail: string | null
  createdAt: string
  starsSyncedAt: string | null
  topicCount: number
  jobsTotal: number
  jobsRunning: number
  jobsFailed: number
  tokens30d: number
  lastJobAt: string | null
}

interface AdminUserRow {
  id: string
  login: string
  name: string | null
  email: string | null
  notification_email: string | null
  created_at: Date | string
  stars_synced_at: Date | string | null
  topic_count: string | number
  jobs_total: string | number
  jobs_running: string | number
  jobs_failed: string | number
  tokens_30d: string | number
  last_job_at: Date | string | null
}

function toIso(value: Date | string | null): string | null {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : value
}

export async function listAdminUserOverview(
  pool: DbPool,
  limit = 200,
): Promise<AdminUserOverview[]> {
  const { rows } = await pool.query<AdminUserRow>(
    `SELECT
       u.id,
       u.login,
       u.name,
       u.email,
       u.prefs->>'notificationEmail' AS notification_email,
       u.created_at,
       u.stars_synced_at,
       (SELECT count(*) FROM jsonb_object_keys(COALESCE(u.profile->'topicWeights', '{}'::jsonb))) AS topic_count,
       (SELECT count(*) FROM ai_jobs j WHERE j.user_id = u.id) AS jobs_total,
       (SELECT count(*) FROM ai_jobs j WHERE j.user_id = u.id AND j.status = 'running') AS jobs_running,
       (SELECT count(*) FROM ai_jobs j WHERE j.user_id = u.id AND j.status = 'failed') AS jobs_failed,
       (SELECT COALESCE(sum(l.prompt_tokens + l.completion_tokens), 0) FROM llm_usage l
          WHERE l.user_id = u.id AND l.created_at > now() - interval '30 days') AS tokens_30d,
       (SELECT max(j.created_at) FROM ai_jobs j WHERE j.user_id = u.id) AS last_job_at
     FROM users u
     ORDER BY u.id
     LIMIT $1`,
    [Math.max(1, Math.min(1000, limit))],
  )
  return rows.map((row) => ({
    id: Number(row.id),
    login: row.login,
    name: row.name,
    email: row.email,
    notificationEmail: row.notification_email,
    createdAt: toIso(row.created_at) ?? '',
    starsSyncedAt: toIso(row.stars_synced_at),
    topicCount: Number(row.topic_count),
    jobsTotal: Number(row.jobs_total),
    jobsRunning: Number(row.jobs_running),
    jobsFailed: Number(row.jobs_failed),
    tokens30d: Number(row.tokens_30d),
    lastJobAt: toIso(row.last_job_at),
  }))
}
