import type { DbPool } from './db.js'

export async function listFeedImpressions(pool: DbPool, userId: number, days = 7): Promise<Set<string>> {
  const { rows } = await pool.query<{ repo_full_name: string }>(
    `SELECT repo_full_name FROM feed_impressions
     WHERE user_id = $1 AND last_seen_at >= now() - ($2::int * INTERVAL '1 day')`,
    [userId, days],
  )
  return new Set(rows.map((row) => row.repo_full_name.toLowerCase()))
}

export async function recordFeedImpressions(pool: DbPool, userId: number, repos: string[]): Promise<void> {
  for (const repo of repos.slice(0, 20)) {
    await pool.query(
      `INSERT INTO feed_impressions (user_id, repo_full_name, last_seen_at)
       VALUES ($1, $2, now())
       ON CONFLICT (user_id, repo_full_name) DO UPDATE SET last_seen_at = now()`,
      [userId, repo],
    )
  }
}
