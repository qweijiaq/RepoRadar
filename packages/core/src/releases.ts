import type { DbPool } from './db.js'

export interface ReleaseEvent {
  repoFullName: string
  tag: string
  name: string | null
  url: string | null
  publishedAt: string | null
}

interface ReleaseEventRow {
  repo_full_name: string
  tag: string
  name: string | null
  url: string | null
  published_at: Date | string | null
}

function toIso(value: Date | string | null): string | null {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : value
}

export async function saveReleaseEvent(pool: DbPool, event: ReleaseEvent): Promise<boolean> {
  const { rowCount } = await pool.query(
    `INSERT INTO release_events (repo_full_name, tag, name, url, published_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (repo_full_name, tag) DO NOTHING`,
    [event.repoFullName, event.tag, event.name, event.url, event.publishedAt],
  )
  return (rowCount ?? 0) > 0
}

export async function loadReleaseEvents(
  pool: DbPool,
  repoFullNames: string[],
  limit = 5,
): Promise<ReleaseEvent[]> {
  if (repoFullNames.length === 0) return []
  const { rows } = await pool.query<ReleaseEventRow>(
    `SELECT repo_full_name, tag, name, url, published_at
     FROM release_events
     WHERE repo_full_name = ANY($1::text[])
     ORDER BY COALESCE(published_at, fetched_at) DESC
     LIMIT $2`,
    [repoFullNames, limit],
  )
  return rows.map((row) => ({
    repoFullName: row.repo_full_name,
    tag: row.tag,
    name: row.name,
    url: row.url,
    publishedAt: toIso(row.published_at),
  }))
}

export async function loadReleaseHistory(
  pool: DbPool,
  repoFullName: string,
  limit = 10,
): Promise<ReleaseEvent[]> {
  const { rows } = await pool.query<ReleaseEventRow>(
    `SELECT repo_full_name, tag, name, url, published_at
     FROM release_events
     WHERE repo_full_name = $1
     ORDER BY COALESCE(published_at, fetched_at) DESC
     LIMIT $2`,
    [repoFullName, limit],
  )
  return rows.map((row) => ({
    repoFullName: row.repo_full_name,
    tag: row.tag,
    name: row.name,
    url: row.url,
    publishedAt: toIso(row.published_at),
  }))
}

export async function loadRecentReleaseEvents(
  pool: DbPool,
  days = 7,
  limit = 10,
): Promise<ReleaseEvent[]> {
  const { rows } = await pool.query<ReleaseEventRow>(
    `SELECT repo_full_name, tag, name, url, published_at
     FROM release_events
     WHERE COALESCE(published_at, fetched_at) >= now() - ($1::int * INTERVAL '1 day')
     ORDER BY COALESCE(published_at, fetched_at) DESC
     LIMIT $2`,
    [days, limit],
  )
  return rows.map((row) => ({
    repoFullName: row.repo_full_name,
    tag: row.tag,
    name: row.name,
    url: row.url,
    publishedAt: toIso(row.published_at),
  }))
}

export async function listReleaseWatchRepos(pool: DbPool): Promise<string[]> {
  const { rows } = await pool.query<{ value: string }>(
    `SELECT DISTINCT value FROM subscriptions WHERE kind = 'release' ORDER BY value`,
  )
  return rows.map((row) => row.value)
}

export async function hasReleaseEvents(pool: DbPool, repoFullName: string): Promise<boolean> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT count(*) FROM release_events WHERE repo_full_name = $1`,
    [repoFullName],
  )
  return Number(rows[0]?.count ?? 0) > 0
}
