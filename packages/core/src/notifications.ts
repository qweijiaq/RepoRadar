import type { DbPool } from './db.js'
import type { ReleaseEvent } from './releases.js'
import { queueNotificationDeliveries } from './deliveries.js'
import { loadNotificationPrefs } from './users.js'

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
      kind: input.kind,
      title: input.title,
      body: input.body ?? null,
      url: input.url ?? null,
    })
  }
}

export interface NotificationListOptions {
  offset?: number
  unreadOnly?: boolean
  kinds?: string[]
  prefixes?: string[]
  excludeKinds?: string[]
  excludePrefixes?: string[]
}

export async function listNotifications(
  pool: DbPool,
  userId: number,
  limit = 50,
  options: NotificationListOptions = {},
): Promise<NotificationRecord[]> {
  const params: unknown[] = [userId]
  const where = ['user_id = $1']
  if (options.unreadOnly) where.push('read_at IS NULL')
  if (options.kinds?.length) {
    params.push(options.kinds)
    where.push(`kind = ANY($${params.length}::text[])`)
  }
  if (options.prefixes?.length) {
    params.push(options.prefixes.map((prefix) => `${prefix}%`))
    where.push(`kind LIKE ANY($${params.length}::text[])`)
  }
  if (options.excludeKinds?.length) {
    params.push(options.excludeKinds)
    where.push(`NOT (kind = ANY($${params.length}::text[]))`)
  }
  if (options.excludePrefixes?.length) {
    params.push(options.excludePrefixes.map((prefix) => `${prefix}%`))
    where.push(`NOT (kind LIKE ANY($${params.length}::text[]))`)
  }
  params.push(limit, Math.max(0, options.offset ?? 0))
  const { rows } = await pool.query<NotificationRow>(
    `SELECT id, kind, title, body, url, created_at, read_at
     FROM notifications
     WHERE ${where.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  )
  return rows.map(mapNotification)
}

export interface NotificationCounts {
  total: number
  unread: number
  github: number
  ai: number
  release: number
  system: number
}

export async function loadNotificationCounts(
  pool: DbPool,
  userId: number,
  aiKinds: string[],
): Promise<NotificationCounts> {
  const { rows } = await pool.query<{
    total: string
    unread: string
    github: string
    ai: string
    release: string
    system: string
  }>(
    `SELECT count(*) AS total,
       count(*) FILTER (WHERE read_at IS NULL) AS unread,
       count(*) FILTER (WHERE kind LIKE 'github-%') AS github,
       count(*) FILTER (WHERE kind = ANY($2::text[])) AS ai,
       count(*) FILTER (WHERE kind = 'release') AS release,
       count(*) FILTER (WHERE NOT (kind LIKE 'github-%' OR kind = ANY($2::text[]) OR kind = 'release')) AS system
     FROM notifications WHERE user_id = $1`,
    [userId, aiKinds],
  )
  const row = rows[0]
  return {
    total: Number(row?.total ?? 0),
    unread: Number(row?.unread ?? 0),
    github: Number(row?.github ?? 0),
    ai: Number(row?.ai ?? 0),
    release: Number(row?.release ?? 0),
    system: Number(row?.system ?? 0),
  }
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

/** 按分类/前缀批量标记已读，参数与 listNotifications 的筛选条件一致。 */
export async function markNotificationsReadMatching(
  pool: DbPool,
  userId: number,
  options: Omit<NotificationListOptions, 'offset' | 'unreadOnly'> = {},
): Promise<number> {
  const params: unknown[] = [userId]
  const where = ['user_id = $1', 'read_at IS NULL']
  if (options.kinds?.length) {
    params.push(options.kinds)
    where.push(`kind = ANY($${params.length}::text[])`)
  }
  if (options.prefixes?.length) {
    params.push(options.prefixes.map((prefix) => `${prefix}%`))
    where.push(`kind LIKE ANY($${params.length}::text[])`)
  }
  if (options.excludeKinds?.length) {
    params.push(options.excludeKinds)
    where.push(`NOT (kind = ANY($${params.length}::text[]))`)
  }
  if (options.excludePrefixes?.length) {
    params.push(options.excludePrefixes.map((prefix) => `${prefix}%`))
    where.push(`NOT (kind LIKE ANY($${params.length}::text[]))`)
  }
  const { rowCount } = await pool.query(
    `UPDATE notifications SET read_at = now() WHERE ${where.join(' AND ')}`,
    params,
  )
  return rowCount ?? 0
}

export async function notifyReleaseSubscribers(pool: DbPool, event: ReleaseEvent): Promise<number> {
  const title = `${event.repoFullName} 发布 ${event.tag}`
  const body = event.name ?? '新版本已发布'
  const { rows } = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM subscriptions WHERE kind = 'release' AND value = $1`,
    [event.repoFullName],
  )

  let notified = 0
  for (const row of rows) {
    const userId = Number(row.user_id)
    const prefs = await loadNotificationPrefs(pool, userId)
    if (!prefs.githubRelease) continue

    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO notifications (user_id, kind, title, body, url)
       VALUES ($1, 'release', $2, $3, $4)
       RETURNING id`,
      [userId, title, body, event.url],
    )
    const id = Number(inserted.rows[0]?.id ?? 0)
    if (id <= 0) continue
    await queueNotificationDeliveries(pool, userId, { id, kind: 'release', title, body, url: event.url })
    notified++
  }
  return notified
}

export async function markNotificationRead(pool: DbPool, userId: number, id: number): Promise<void> {
  await pool.query(
    `UPDATE notifications SET read_at = now()
     WHERE user_id = $1 AND id = $2 AND read_at IS NULL`,
    [userId, id],
  )
}
