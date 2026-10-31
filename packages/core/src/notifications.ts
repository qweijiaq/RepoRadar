import type { DbPool } from './db.js'
import type { ReleaseEvent } from './releases.js'
import { queueNotificationDeliveries } from './deliveries.js'

export interface NotificationRecord {
  id: number
  kind: string
  title: string
  body: string | null
  url: string | null
  createdAt: string
  readAt: string | null
}

interface NotificationRow {
  id: string
  kind: string
  title: string
  body: string | null
  url: string | null
  created_at: Date | string
  read_at: Date | string | null
}

function toIso(value: Date | string | null): string | null {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : value
}

function mapNotification(row: NotificationRow): NotificationRecord {
  return {
    id: Number(row.id),
    kind: row.kind,
    title: row.title,
    body: row.body,
    url: row.url,
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    readAt: toIso(row.read_at),
  }
}

export async function addNotification(
  pool: DbPool,
  userId: number,
  input: { kind: string; title: string; body?: string | null; url?: string | null },
): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO notifications (user_id, kind, title, body, url) VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [userId, input.kind, input.title, input.body ?? null, input.url ?? null],
  )
  const id = Number(rows[0]?.id ?? 0)
  if (id > 0) {
    await queueNotificationDeliveries(pool, userId, {
      id,
      title: input.title,
      body: input.body ?? null,
      url: input.url ?? null,
    })
  }
}

export async function listNotifications(pool: DbPool, userId: number, limit = 50): Promise<NotificationRecord[]> {
  const { rows } = await pool.query<NotificationRow>(
    `SELECT id, kind, title, body, url, created_at, read_at
     FROM notifications
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit],
  )
  return rows.map(mapNotification)
}

export async function countUnreadNotifications(pool: DbPool, userId: number): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT count(*) FROM notifications WHERE user_id = $1 AND read_at IS NULL`,
    [userId],
  )
  return Number(rows[0]?.count ?? 0)
}

export async function markNotificationsRead(pool: DbPool, userId: number): Promise<void> {
  await pool.query(`UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`, [userId])
}

export async function notifyReleaseSubscribers(pool: DbPool, event: ReleaseEvent): Promise<number> {
  const title = `${event.repoFullName} 发布 ${event.tag}`
  const body = event.name ?? '新版本已发布'
  const { rows } = await pool.query<{ id: string; user_id: string }>(
    `INSERT INTO notifications (user_id, kind, title, body, url)
     SELECT user_id, 'release', $1, $2, $3
     FROM subscriptions
     WHERE kind = 'release' AND value = $4
     RETURNING id, user_id`,
    [title, body, event.url, event.repoFullName],
  )
  for (const row of rows) {
    await queueNotificationDeliveries(pool, Number(row.user_id), {
      id: Number(row.id),
      title,
      body,
      url: event.url,
    })
  }
  return rows.length
}

export async function markNotificationRead(pool: DbPool, userId: number, id: number): Promise<void> {
  await pool.query(
    `UPDATE notifications SET read_at = now()
     WHERE user_id = $1 AND id = $2 AND read_at IS NULL`,
    [userId, id],
  )
}
