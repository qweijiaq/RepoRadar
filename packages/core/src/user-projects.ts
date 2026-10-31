import type { DbPool } from './db.js'

export type ProjectSource = 'owned' | 'manual'

export interface UserProjectRecord {
  repoFullName: string
  source: ProjectSource
  active: boolean
  lastPushedAt: string | null
  description: string | null
  language: string | null
  topics: string[]
  stars: number
  pushedAt: string | null
}

interface UserProjectRow {
  repo_full_name: string
  source: ProjectSource
  active: boolean
  last_pushed_at: Date | string | null
  description: string | null
  language: string | null
  topics: string[] | null
  stars: number | null
  pushed_at: Date | string | null
}

function toIso(value: Date | string | null): string | null {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : value
}

export async function listUserProjects(pool: DbPool, userId: number): Promise<UserProjectRecord[]> {
  const { rows } = await pool.query<UserProjectRow>(
    `SELECT p.repo_full_name, p.source, p.active, p.last_pushed_at,
            r.description, r.language, r.topics, r.stars, r.pushed_at
     FROM user_projects p
     LEFT JOIN repos r ON r.full_name = p.repo_full_name
     WHERE p.user_id = $1
     ORDER BY p.active DESC, COALESCE(p.last_pushed_at, r.pushed_at) DESC NULLS LAST`,
    [userId],
  )
  return rows.map((row) => ({
    repoFullName: row.repo_full_name,
    source: row.source,
    active: row.active,
    lastPushedAt: toIso(row.last_pushed_at),
    description: row.description,
    language: row.language,
    topics: row.topics ?? [],
    stars: row.stars ?? 0,
    pushedAt: toIso(row.pushed_at),
  }))
}

export async function upsertUserProject(
  pool: DbPool,
  userId: number,
  repoFullName: string,
  input: { source: ProjectSource; active?: boolean; lastPushedAt?: string | null },
): Promise<void> {
  await pool.query(
    `INSERT INTO user_projects (user_id, repo_full_name, source, active, last_pushed_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, repo_full_name) DO UPDATE SET
       last_pushed_at = COALESCE(EXCLUDED.last_pushed_at, user_projects.last_pushed_at)`,
    [userId, repoFullName, input.source, input.active ?? true, input.lastPushedAt ?? null],
  )
}

export async function setUserProjectActive(
  pool: DbPool,
  userId: number,
  repoFullName: string,
  active: boolean,
): Promise<void> {
  await pool.query(`UPDATE user_projects SET active = $3 WHERE user_id = $1 AND repo_full_name = $2`, [
    userId,
    repoFullName,
    active,
  ])
}

export async function removeUserProject(pool: DbPool, userId: number, repoFullName: string): Promise<void> {
  await pool.query(`DELETE FROM user_projects WHERE user_id = $1 AND repo_full_name = $2`, [userId, repoFullName])
}

export async function renameUserProject(
  pool: DbPool,
  userId: number,
  oldFullName: string,
  newFullName: string,
): Promise<void> {
  if (oldFullName === newFullName) return
  await pool.query(
    `INSERT INTO user_projects (user_id, repo_full_name, source, active, last_pushed_at)
     SELECT user_id, $3, source, active, last_pushed_at
     FROM user_projects
     WHERE user_id = $1 AND repo_full_name = $2
     ON CONFLICT (user_id, repo_full_name) DO UPDATE SET active = EXCLUDED.active`,
    [userId, oldFullName, newFullName],
  )
  await pool.query(`DELETE FROM user_projects WHERE user_id = $1 AND repo_full_name = $2`, [userId, oldFullName])
}
