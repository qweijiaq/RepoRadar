import type { DbPool } from './db.js'
import { findUserById, loadNotificationPrefs, resolveNotificationEmail } from './users.js'

export type DeliveryChannel = 'email' | 'push'

export interface DeliveryInput {
  userId: number
  channel: DeliveryChannel
  subject: string
  body?: string | null
  bodyHtml?: string | null
  url?: string | null
  dedupeKey?: string | null
}

export interface DeliveryRecord {
  id: number
  userId: number
  login: string
  email: string | null
  channel: DeliveryChannel
  subject: string
  body: string | null
  bodyHtml: string | null
  url: string | null
  attempts: number
}

export interface DeliveryResult {
  queued: number
  reason?: string
}

function isoWeekKey(date: Date): string {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = utc.getUTCDay() || 7
  utc.setUTCDate(utc.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

export async function enqueueDelivery(pool: DbPool, input: DeliveryInput): Promise<boolean> {
  if (!input.subject.trim()) return false
  const { rowCount } = await pool.query(
    `INSERT INTO delivery_queue (user_id, channel, subject, body, body_html, url, dedupe_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id, channel, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
    [
      input.userId,
      input.channel,
      input.subject.trim().slice(0, 200),
      input.body ?? null,
      input.bodyHtml ?? null,
      input.url ?? null,
      input.dedupeKey ?? null,
    ],
  )
  return (rowCount ?? 0) > 0
}

/**
 * 把一条站内通知按用户偏好投递到邮箱或浏览器推送。
 * 站内收件箱始终保留，投递失败不影响通知本身。
 */
export async function queueNotificationDeliveries(
  pool: DbPool,
  userId: number,
  notification: { id: number; title: string; body?: string | null; url?: string | null },
): Promise<DeliveryResult> {
  const user = await findUserById(pool, userId)
  const email = resolveNotificationEmail(user)
  const prefs = await loadNotificationPrefs(pool, userId)

  let queued = 0
  if (prefs.emailNotifications && email) {
    const inserted = await enqueueDelivery(pool, {
      userId,
      channel: 'email',
      subject: notification.title,
      body: notification.body ?? notification.title,
      url: notification.url,
      dedupeKey: `notification:${notification.id}`,
    })
    if (inserted) queued += 1
  }

  if (prefs.pushNotifications) {
    const subscriptions = await pool.query(`SELECT 1 FROM push_subscriptions WHERE user_id = $1 LIMIT 1`, [userId])
    if ((subscriptions.rowCount ?? 0) > 0) {
      const inserted = await enqueueDelivery(pool, {
        userId,
        channel: 'push',
        subject: notification.title,
        body: notification.body ?? null,
        url: notification.url,
        dedupeKey: `notification:${notification.id}`,
      })
      if (inserted) queued += 1
    }
  }

  return {
    queued,
    reason: prefs.emailNotifications || prefs.pushNotifications ? undefined : 'delivery-disabled',
  }
}

export async function enqueueWeeklyDigest(
  pool: DbPool,
  input: {
    userId: number
    login: string
    subject: string
    text: string
    html: string
    date?: Date
  },
): Promise<boolean> {
  return enqueueDelivery(pool, {
    userId: input.userId,
    channel: 'email',
    subject: input.subject,
    body: input.text,
    bodyHtml: input.html,
    url: '/feed',
    dedupeKey: `weekly:${isoWeekKey(input.date ?? new Date())}`,
  })
}

export async function hasSentWeeklyDigest(pool: DbPool, userId: number, date = new Date()): Promise<boolean> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT count(*) FROM delivery_queue
     WHERE user_id = $1 AND channel = 'email' AND dedupe_key = $2 AND status = 'sent'`,
    [userId, `weekly:${isoWeekKey(date)}`],
  )
  return Number(rows[0]?.count ?? 0) > 0
}

export async function listPendingDeliveries(pool: DbPool, limit = 10): Promise<DeliveryRecord[]> {
  const { rows } = await pool.query<{
    id: string
    user_id: string
    login: string
    email: string | null
    channel: DeliveryChannel
    subject: string
    body: string | null
    body_html: string | null
    url: string | null
    attempts: number
  }>(
    `SELECT d.id, d.user_id, u.login,
       COALESCE(NULLIF(btrim(u.prefs->>'notificationEmail'), ''), u.email) AS email,
       d.channel, d.subject, d.body, d.body_html, d.url, d.attempts
     FROM delivery_queue d
     JOIN users u ON u.id = d.user_id
     WHERE d.status = 'queued' AND d.next_attempt_at <= now()
     ORDER BY d.created_at
     LIMIT $1`,
    [limit],
  )
  return rows.map((row) => ({
    id: Number(row.id),
    userId: Number(row.user_id),
    login: row.login,
    email: row.email,
    channel: row.channel,
    subject: row.subject,
    body: row.body,
    bodyHtml: row.body_html,
    url: row.url,
    attempts: row.attempts,
  }))
}

export async function markDeliverySent(pool: DbPool, id: number): Promise<void> {
  await pool.query(
    `UPDATE delivery_queue SET status = 'sent', sent_at = now(), last_error = NULL WHERE id = $1`,
    [id],
  )
}

export async function markDeliveryFailed(pool: DbPool, id: number, error: string): Promise<void> {
  const message = error.trim().slice(0, 800) || '未知错误'
  await pool.query(
    `UPDATE delivery_queue SET
       attempts = attempts + 1,
       last_error = $2,
       status = CASE WHEN attempts + 1 >= 3 THEN 'failed' ELSE 'queued' END,
       next_attempt_at = now() + make_interval(mins => (attempts + 1) * 10)
     WHERE id = $1`,
    [id, message],
  )
}

export async function countPendingDeliveries(pool: DbPool, userId?: number): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    userId
      ? `SELECT count(*) FROM delivery_queue WHERE status = 'queued' AND user_id = $1`
      : `SELECT count(*) FROM delivery_queue WHERE status = 'queued'`,
    userId ? [userId] : [],
  )
  return Number(rows[0]?.count ?? 0)
}
