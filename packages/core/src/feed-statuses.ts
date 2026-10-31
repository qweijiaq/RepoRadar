import type { DbPool } from './db.js'

export interface FeedStatus {
  key: string
  kind: string
  status: 'done'
  note: string | null
  updatedAt: string
}

export async function listFeedStatuses(pool: DbPool, userId: number): Promise<FeedStatus[]> {
  const { rows } = await pool.query<{
    item_key: string
    kind: string
    status: 'done'
    note: string | null
    updated_at: Date | string
  }>(
    `SELECT item_key, kind, status, note, updated_at FROM feed_statuses
     WHERE user_id = $1 ORDER BY updated_at DESC`,
    [userId],
  )
  return rows.map((row) => ({
    key: row.item_key,
    kind: row.kind,
    status: row.status,
    note: row.note,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  }))
}

export async function markFeedItemDone(
  pool: DbPool,
  userId: number,
  key: string,
  kind: string,
  note: string | null = null,
): Promise<void> {
  await pool.query(
    `INSERT INTO feed_statuses (user_id, item_key, kind, status, note)
     VALUES ($1, $2, $3, 'done', $4)
     ON CONFLICT (user_id, item_key) DO UPDATE SET
       kind = EXCLUDED.kind,
       status = 'done',
       note = EXCLUDED.note,
       updated_at = now()`,
    [userId, key, kind, note],
  )
}

export function feedStatusKeys(statuses: FeedStatus[]): Set<string> {
  return new Set(statuses.map((status) => status.key))
}
