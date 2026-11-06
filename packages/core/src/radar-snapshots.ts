import { randomUUID } from 'node:crypto'
import type { DbPool } from './db.js'

export interface RadarSnapshot {
  login: string
  mode: string
  persona: { name: string; detail: string }
  opportunities: Array<{
    kind: string
    title: string
    detail: string
    evidence: string[]
    repo: string | null
  }>
  gems: Array<{
    repo: string
    description: string
    stars: number
    language: string | null
    reasons: string[]
    htmlUrl: string
  }>
  createdAt: string
}

interface RadarSnapshotRow {
  token: string
  payload: RadarSnapshot
  created_at: Date | string
  expires_at: Date | string | null
  revoked_at: Date | string | null
  view_count: string
  last_viewed_at: Date | string | null
}

export interface RadarSnapshotSummary {
  token: string
  login: string
  mode: string
  createdAt: string
  expiresAt: string | null
  revokedAt: string | null
  viewCount: number
  lastViewedAt: string | null
}

function iso(value: Date | string | null): string | null {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : value
}

/** 分享链接默认保留 90 天；过期或撤销后公开页返回 404。 */
export const RADAR_SNAPSHOT_TTL_DAYS = 90

export async function saveRadarSnapshot(
  pool: DbPool,
  userId: number,
  payload: Omit<RadarSnapshot, 'createdAt'>,
): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const token = randomUUID().replace(/-/g, '').slice(0, 12)
    try {
      await pool.query(
        `INSERT INTO radar_snapshots (token, user_id, payload, expires_at)
         VALUES ($1, $2, $3, now() + ($4::int * INTERVAL '1 day'))`,
        [token, userId, JSON.stringify({ ...payload, createdAt: new Date().toISOString() }), RADAR_SNAPSHOT_TTL_DAYS],
      )
      return token
    } catch (error) {
      if (attempt === 2) throw error
    }
  }
  throw new Error('创建分享链接失败')
}

export async function findRadarSnapshot(pool: DbPool, token: string): Promise<RadarSnapshot | null> {
  if (!/^[a-zA-Z0-9]{6,32}$/.test(token)) return null
  const { rows } = await pool.query<RadarSnapshotRow>(
    `SELECT token, payload, created_at, expires_at, revoked_at, view_count, last_viewed_at
     FROM radar_snapshots
     WHERE token = $1
       AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > now())
     LIMIT 1`,
    [token],
  )
  return rows[0]?.payload ?? null
}

/** 公开页每次渲染调用一次；返回最新的浏览数。 */
export async function recordRadarSnapshotView(pool: DbPool, token: string): Promise<number | null> {
  const { rows } = await pool.query<{ view_count: string }>(
    `UPDATE radar_snapshots
     SET view_count = view_count + 1, last_viewed_at = now()
     WHERE token = $1
       AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > now())
     RETURNING view_count`,
    [token],
  )
  return rows[0] ? Number(rows[0].view_count) : null
}

export async function listRadarSnapshots(
  pool: DbPool,
  userId: number,
  limit = 10,
): Promise<RadarSnapshotSummary[]> {
  const { rows } = await pool.query<RadarSnapshotRow>(
    `SELECT token, payload, created_at, expires_at, revoked_at, view_count, last_viewed_at
     FROM radar_snapshots
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, Math.max(1, Math.min(50, limit))],
  )
  return rows.map((row) => ({
    token: row.token,
    login: row.payload.login,
    mode: row.payload.mode,
    createdAt: iso(row.created_at) ?? new Date().toISOString(),
    expiresAt: iso(row.expires_at),
    revokedAt: iso(row.revoked_at),
    viewCount: Number(row.view_count ?? 0),
    lastViewedAt: iso(row.last_viewed_at),
  }))
}

export async function revokeRadarSnapshot(
  pool: DbPool,
  userId: number,
  token: string,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE radar_snapshots
     SET revoked_at = now()
     WHERE token = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [token, userId],
  )
  return (rowCount ?? 0) > 0
}
