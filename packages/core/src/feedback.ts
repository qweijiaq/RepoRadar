import type { DbPool } from './db.js'

export type FeedbackKind = 'save' | 'hide'

export interface FeedbackSignal {
  topics: string[]
  kind: FeedbackKind
}

export async function loadFeedback(pool: DbPool, userId: number): Promise<Map<string, FeedbackKind>> {
  const { rows } = await pool.query<{ repo_full_name: string; kind: FeedbackKind }>(
    `SELECT repo_full_name, kind FROM feedback WHERE user_id = $1`,
    [userId],
  )
  return new Map(rows.map((row) => [row.repo_full_name, row.kind]))
}

export async function setFeedback(
  pool: DbPool,
  userId: number,
  repoFullName: string,
  kind: FeedbackKind | null,
): Promise<void> {
  if (kind === null) {
    await pool.query(`DELETE FROM feedback WHERE user_id = $1 AND repo_full_name = $2`, [userId, repoFullName])
    return
  }
  await pool.query(
    `INSERT INTO feedback (user_id, repo_full_name, kind) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, repo_full_name) DO UPDATE SET kind = EXCLUDED.kind, created_at = now()`,
    [userId, repoFullName, kind],
  )
}

export async function listFeedbackSignals(pool: DbPool, userId: number): Promise<FeedbackSignal[]> {
  const { rows } = await pool.query<{ topics: string[] | null; kind: FeedbackKind }>(
    `SELECT r.topics, f.kind
     FROM feedback f
     JOIN repos r ON r.full_name = f.repo_full_name
     WHERE f.user_id = $1`,
    [userId],
  )
  return rows.map((row) => ({ topics: row.topics ?? [], kind: row.kind }))
}
