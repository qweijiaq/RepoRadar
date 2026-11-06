import { randomUUID } from 'node:crypto'
import type { DbPool } from './db.js'
import { isTeamRole, type TeamRole } from './teams.js'

export type CollectionAccess = 'owner' | 'write' | 'read'

export interface CollectionRecord {
  id: number
  userId: number
  name: string
  description: string | null
  isPublic: boolean
  publicSlug: string | null
  teamId: number | null
  teamName: string | null
  teamRole: TeamRole | null
  access: CollectionAccess
  createdAt: string
  itemCount: number
  viewCount: number
  lastViewedAt: string | null
}

interface CollectionRow {
  id: string
  user_id: string
  name: string
  description: string | null
  is_public: boolean
  public_slug: string | null
  team_id: string | null
  team_name?: string | null
  team_role?: string | null
  created_at: Date | string
  item_count?: string
  view_count?: string
  last_viewed_at?: Date | string | null
}

function newPublicSlug(): string {
  return randomUUID().replace(/-/g, '').slice(0, 12)
}

function mapCollection(row: CollectionRow, userId = 0): CollectionRecord {
  const teamRole = row.team_role && isTeamRole(row.team_role) ? row.team_role : null
  const access: CollectionAccess =
    Number(row.user_id) === userId
      ? 'owner'
      : teamRole
        ? teamRole === 'viewer'
          ? 'read'
          : 'write'
        : 'read'

  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    name: row.name,
    description: row.description,
    isPublic: row.is_public,
    publicSlug: row.public_slug,
    teamId: row.team_id ? Number(row.team_id) : null,
    teamName: row.team_name ?? null,
    teamRole,
    access,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    itemCount: Number(row.item_count ?? 0),
    viewCount: Number(row.view_count ?? 0),
    lastViewedAt: row.last_viewed_at
      ? row.last_viewed_at instanceof Date
        ? row.last_viewed_at.toISOString()
        : row.last_viewed_at
      : null,
  }
}

const COLLECTION_SELECT = `SELECT c.*, t.name AS team_name, tm.role AS team_role,
  (SELECT count(*) FROM collection_items i WHERE i.collection_id = c.id) AS item_count
  FROM collections c
  LEFT JOIN teams t ON t.id = c.team_id
  LEFT JOIN team_members tm ON tm.team_id = c.team_id AND tm.user_id = $1`

/** 个人收藏集 + 用户所在团队的收藏集。 */
export async function listCollections(pool: DbPool, userId: number): Promise<CollectionRecord[]> {
  const { rows } = await pool.query<CollectionRow>(
    `${COLLECTION_SELECT}
     WHERE c.user_id = $1 OR tm.user_id IS NOT NULL
     ORDER BY c.created_at DESC`,
    [userId],
  )
  return rows.map((row) => mapCollection(row, userId))
}

/** 不校验成员身份，调用方负责公开/私有判断。 */
export async function findCollection(pool: DbPool, id: number): Promise<CollectionRecord | null> {
  const { rows } = await pool.query<CollectionRow>(
    `${COLLECTION_SELECT}
     WHERE c.id = $2
     LIMIT 1`,
    [0, id],
  )
  const row = rows[0]
  return row ? mapCollection(row) : null
}

/** 返回用户可访问的收藏集，并带上 owner/write/read 权限。 */
export async function findCollectionAccess(
  pool: DbPool,
  userId: number,
  id: number,
): Promise<CollectionRecord | null> {
  const { rows } = await pool.query<CollectionRow>(
    `${COLLECTION_SELECT}
     WHERE c.id = $2 AND (c.user_id = $1 OR tm.user_id IS NOT NULL)
     LIMIT 1`,
    [userId, id],
  )
  const row = rows[0]
  return row ? mapCollection(row, userId) : null
}

/** 公开收藏集按随机 slug 访问；私有收藏集不会通过 slug 暴露。 */
export async function findPublicCollectionBySlug(
  pool: DbPool,
  slug: string,
): Promise<CollectionRecord | null> {
  if (!/^[a-zA-Z0-9]{6,32}$/.test(slug)) return null
  const { rows } = await pool.query<CollectionRow>(
    `${COLLECTION_SELECT}
     WHERE c.public_slug = $2 AND c.is_public = TRUE
     LIMIT 1`,
    [0, slug],
  )
  const row = rows[0]
  return row ? mapCollection(row) : null
}

export async function recordPublicCollectionView(pool: DbPool, slug: string): Promise<number | null> {
  if (!/^[a-zA-Z0-9]{6,32}$/.test(slug)) return null
  const { rows } = await pool.query<{ view_count: string }>(
    `UPDATE collections
     SET view_count = view_count + 1, last_viewed_at = now()
     WHERE public_slug = $1 AND is_public = TRUE
     RETURNING view_count`,
    [slug],
  )
  return rows[0] ? Number(rows[0].view_count) : null
}

export async function createCollection(
  pool: DbPool,
  userId: number,
  name: string,
  description: string | null = null,
  teamId: number | null = null,
): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO collections (user_id, name, description, public_slug, team_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [userId, name, description, newPublicSlug(), teamId],
  )
  return Number(rows[0]?.id ?? 0)
}

export interface CollectionItem {
  repoFullName: string
  note: string | null
  addedAt: string
}

interface CollectionItemRow {
  repo_full_name: string
  note: string | null
  added_at: Date | string
}

export async function listCollectionItems(pool: DbPool, collectionId: number): Promise<CollectionItem[]> {
  const { rows } = await pool.query<CollectionItemRow>(
    `SELECT repo_full_name, note, added_at FROM collection_items WHERE collection_id = $1 ORDER BY added_at DESC`,
    [collectionId],
  )
  return rows.map((row) => ({
    repoFullName: row.repo_full_name,
    note: row.note,
    addedAt: row.added_at instanceof Date ? row.added_at.toISOString() : row.added_at,
  }))
}

export async function addCollectionItem(
  pool: DbPool,
  collectionId: number,
  repoFullName: string,
  note: string | null = null,
): Promise<void> {
  await pool.query(
    `INSERT INTO collection_items (collection_id, repo_full_name, note) VALUES ($1, $2, $3)
     ON CONFLICT (collection_id, repo_full_name) DO UPDATE SET note = COALESCE(EXCLUDED.note, collection_items.note)`,
    [collectionId, repoFullName, note],
  )
}

export async function removeCollectionItem(
  pool: DbPool,
  collectionId: number,
  repoFullName: string,
): Promise<void> {
  await pool.query(`DELETE FROM collection_items WHERE collection_id = $1 AND repo_full_name = $2`, [
    collectionId,
    repoFullName,
  ])
}

export async function setCollectionPublic(pool: DbPool, collectionId: number, isPublic: boolean): Promise<void> {
  await pool.query(
    `UPDATE collections
     SET is_public = $2,
         public_slug = CASE
           WHEN $2 = TRUE AND public_slug IS NULL THEN $3
           ELSE public_slug
         END
     WHERE id = $1`,
    [collectionId, isPublic, newPublicSlug()],
  )
}

export async function deleteCollection(pool: DbPool, collectionId: number): Promise<void> {
  await pool.query(`DELETE FROM collections WHERE id = $1`, [collectionId])
}
