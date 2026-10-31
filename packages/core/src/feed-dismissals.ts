import type { DbPool } from './db.js'

export type FeedDismissReason = 'too-broad' | 'too-official' | 'not-my-stack' | 'already-known' | 'other'

export const FEED_DISMISS_REASONS: Array<{ value: FeedDismissReason; label: string }> = [
  { value: 'too-broad', label: '太宽泛，不是我想找的' },
  { value: 'too-official', label: '又是官方/大厂项目' },
  { value: 'not-my-stack', label: '不是我的技术栈或方向' },
  { value: 'already-known', label: '我早就知道了' },
  { value: 'other', label: '其他原因' },
]

export function isFeedDismissReason(value: string): value is FeedDismissReason {
  return FEED_DISMISS_REASONS.some((reason) => reason.value === value)
}

export interface FeedDismissal {
  key: string
  kind: string
  reason: FeedDismissReason
  createdAt: string
}

export async function listFeedDismissals(pool: DbPool, userId: number): Promise<FeedDismissal[]> {
  const { rows } = await pool.query<{
    item_key: string
    kind: string
    reason: FeedDismissReason
    created_at: Date | string
  }>(
    `SELECT item_key, kind, reason, created_at FROM feed_dismissals
     WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  )
  return rows.map((row) => ({
    key: row.item_key,
    kind: row.kind,
    reason: row.reason,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  }))
}

export async function dismissFeedItem(
  pool: DbPool,
  userId: number,
  key: string,
  kind: string,
  reason: FeedDismissReason,
  note: string | null = null,
): Promise<void> {
  await pool.query(
    `INSERT INTO feed_dismissals (user_id, item_key, kind, reason, note)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, item_key) DO UPDATE SET
       kind = EXCLUDED.kind,
       reason = EXCLUDED.reason,
       note = EXCLUDED.note,
       created_at = now()`,
    [userId, key, kind, reason, note],
  )
}
