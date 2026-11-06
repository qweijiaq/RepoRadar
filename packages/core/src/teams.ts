import type { DbPool } from './db.js'
import { findUserByLogin } from './users.js'

export type TeamRole = 'owner' | 'admin' | 'member' | 'viewer'

export const TEAM_ROLES: TeamRole[] = ['owner', 'admin', 'member', 'viewer']

export const TEAM_ROLE_LABEL: Record<TeamRole, string> = {
  owner: '所有者',
  admin: '管理员',
  member: '成员',
  viewer: '只读',
}

export function isTeamRole(value: string): value is TeamRole {
  return (TEAM_ROLES as string[]).includes(value)
}

/** 目前只有所有者可以转让/删除团队；管理员负责成员管理。 */
export function canManageTeam(role: TeamRole): boolean {
  return role === 'owner' || role === 'admin'
}

/** 团队成员可以创建/编辑共享资源，只读成员只能查看。 */
export function canWriteTeam(role: TeamRole): boolean {
  return role !== 'viewer'
}

export function canAdminTeam(role: TeamRole): boolean {
  return role === 'owner'
}

/** 创建/修改成员时只允许分配非 owner 角色；owner 由创建团队时唯一指定。 */
export function isAssignableTeamRole(value: string): value is Exclude<TeamRole, 'owner'> {
  return value === 'admin' || value === 'member' || value === 'viewer'
}

export interface TeamSummary {
  id: number
  name: string
  ownerUserId: number
  role: TeamRole
  memberCount: number
  digestEnabled: boolean
  createdAt: string
}

export interface TeamMember {
  userId: number
  login: string
  displayName: string | null
  avatarUrl: string | null
  role: TeamRole
  joinedAt: string
}

interface TeamRow {
  id: string
  name: string
  owner_user_id: string
  role: string
  member_count: string
  digest_enabled: boolean
  created_at: Date | string
}

interface MemberRow {
  user_id: string
  login: string
  name: string | null
  avatar_url: string | null
  role: string
  created_at: Date | string
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value
}

export async function createTeam(pool: DbPool, ownerUserId: number, name: string): Promise<number> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO teams (name, owner_user_id) VALUES ($1, $2) RETURNING id`,
      [name.trim().slice(0, 80), ownerUserId],
    )
    const id = Number(rows[0]?.id ?? 0)
    if (!id) throw new Error('创建团队失败')
    await client.query(
      `INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [id, ownerUserId],
    )
    await client.query('COMMIT')
    return id
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

export async function listTeamsForUser(pool: DbPool, userId: number): Promise<TeamSummary[]> {
  const { rows } = await pool.query<TeamRow>(
    `SELECT t.id, t.name, t.owner_user_id, t.created_at, t.digest_enabled, m.role,
       (SELECT count(*) FROM team_members x WHERE x.team_id = t.id) AS member_count
     FROM teams t
     JOIN team_members m ON m.team_id = t.id AND m.user_id = $1
     ORDER BY t.created_at DESC`,
    [userId],
  )
  return rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    ownerUserId: Number(row.owner_user_id),
    role: isTeamRole(row.role) ? row.role : 'viewer',
    memberCount: Number(row.member_count),
    digestEnabled: row.digest_enabled,
    createdAt: iso(row.created_at),
  }))
}

export async function findTeamForUser(
  pool: DbPool,
  userId: number,
  teamId: number,
): Promise<TeamSummary | null> {
  const { rows } = await pool.query<TeamRow>(
    `SELECT t.id, t.name, t.owner_user_id, t.created_at, t.digest_enabled, m.role,
       (SELECT count(*) FROM team_members x WHERE x.team_id = t.id) AS member_count
     FROM teams t
     JOIN team_members m ON m.team_id = t.id AND m.user_id = $1
     WHERE t.id = $2
     LIMIT 1`,
    [userId, teamId],
  )
  const row = rows[0]
  if (!row) return null
  return {
    id: Number(row.id),
    name: row.name,
    ownerUserId: Number(row.owner_user_id),
    role: isTeamRole(row.role) ? row.role : 'viewer',
    memberCount: Number(row.member_count),
    digestEnabled: row.digest_enabled,
    createdAt: iso(row.created_at),
  }
}

export async function listTeamMembers(pool: DbPool, teamId: number): Promise<TeamMember[]> {
  const { rows } = await pool.query<MemberRow>(
    `SELECT m.user_id, u.login, u.name, u.avatar_url, m.role, m.created_at
     FROM team_members m
     JOIN users u ON u.id = m.user_id
     WHERE m.team_id = $1
     ORDER BY
       CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END,
       u.login`,
    [teamId],
  )
  return rows.map((row) => ({
    userId: Number(row.user_id),
    login: row.login,
    displayName: row.name,
    avatarUrl: row.avatar_url,
    role: isTeamRole(row.role) ? row.role : 'viewer',
    joinedAt: iso(row.created_at),
  }))
}

export type AddTeamMemberResult =
  | { ok: true; userId: number }
  | { ok: false; reason: 'not-found' | 'exists' | 'invalid-role' }

export async function addTeamMemberByLogin(
  pool: DbPool,
  teamId: number,
  login: string,
  role: string,
): Promise<AddTeamMemberResult> {
  if (!isAssignableTeamRole(role)) return { ok: false, reason: 'invalid-role' }
  const user = await findUserByLogin(pool, login.trim().replace(/^@/, ''))
  if (!user) return { ok: false, reason: 'not-found' }
  const { rowCount } = await pool.query(
    `INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, $3)
     ON CONFLICT (team_id, user_id) DO NOTHING`,
    [teamId, user.id, role],
  )
  return rowCount ? { ok: true, userId: user.id } : { ok: false, reason: 'exists' }
}

export async function updateTeamMemberRole(
  pool: DbPool,
  teamId: number,
  userId: number,
  role: string,
): Promise<boolean> {
  if (!isAssignableTeamRole(role)) return false
  const { rowCount } = await pool.query(
    `UPDATE team_members SET role = $3
     WHERE team_id = $1 AND user_id = $2 AND role <> 'owner'`,
    [teamId, userId, role],
  )
  return (rowCount ?? 0) > 0
}

/** 所有者不会被移除；如需移除所有者，应先转让或删除团队。 */
export async function removeTeamMember(
  pool: DbPool,
  teamId: number,
  userId: number,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM team_members WHERE team_id = $1 AND user_id = $2 AND role <> 'owner'`,
    [teamId, userId],
  )
  return (rowCount ?? 0) > 0
}

export async function setTeamDigestEnabled(
  pool: DbPool,
  teamId: number,
  enabled: boolean,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE teams SET digest_enabled = $2 WHERE id = $1`,
    [teamId, enabled],
  )
  return (rowCount ?? 0) > 0
}

export async function listTeamsWithDigest(
  pool: DbPool,
): Promise<Array<{ id: number; name: string }>> {
  const { rows } = await pool.query<{ id: string; name: string }>(
    `SELECT id, name FROM teams WHERE digest_enabled = TRUE ORDER BY id`,
  )
  return rows.map((row) => ({ id: Number(row.id), name: row.name }))
}

export async function deleteTeam(pool: DbPool, teamId: number, ownerUserId: number): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM teams WHERE id = $1 AND owner_user_id = $2`,
    [teamId, ownerUserId],
  )
  return (rowCount ?? 0) > 0
}
