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
}

export async function saveRadarSnapshot(
  pool: DbPool,
  userId: number,
  payload: Omit<RadarSnapshot, 'createdAt'>,
): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const token = randomUUID().replace(/-/g, '').slice(0, 12)
    try {
      await pool.query(
        `INSERT INTO radar_snapshots (token, user_id, payload) VALUES ($1, $2, $3)`,
        [token, userId, JSON.stringify({ ...payload, createdAt: new Date().toISOString() })],
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
    `SELECT token, payload, created_at FROM radar_snapshots WHERE token = $1 LIMIT 1`,
    [token],
  )
  return rows[0]?.payload ?? null
}
