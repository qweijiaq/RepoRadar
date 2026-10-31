import type { DbPool } from './db.js'

export interface CollectionRecord {
  id: number
  userId: number
  name: string
  description: string | null
  isPublic: boolean
  createdAt: string
  itemCount: number
}

interface CollectionRow {
  id: string
  user_id: string
  name: string
  description: string | null
  is_public: boolean
  created_at: Date | string
  item_count?: string
}

function mapCollection(row: CollectionRow): CollectionRecord {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    name: row.name,
    description: row.description,
    isPublic: row.is_public,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    itemCount: Number(row.item_count ?? 0),
  }
}

export async function listCollections(pool: DbPool, userId: number): Promise<CollectionRecord[]> {
  const { rows } = await pool.query<CollectionRow>(
    `SELECT c.*, (SELECT count(*) FROM collection_items i WHERE i.collection_id = c.id) AS item_count
     FROM collections c
     WHERE c.user_id = $1
     ORDER BY c.created_at DESC`,
    [userId],
  )
  return rows.map(mapCollection)
}

export async function findCollection(pool: DbPool, id: number): Promise<CollectionRecord | null> {
  const { rows } = await pool.query<CollectionRow>(
    `SELECT c.*, (SELECT count(*) FROM collection_items i WHERE i.collection_id = c.id) AS item_count
     FROM collections c
     WHERE c.id = $1
     LIMIT 1`,
    [id],
  )
  const row = rows[0]
  return row ? mapCollection(row) : null
}

export async function createCollection(
  pool: DbPool,
  userId: number,
  name: string,
  description: string | null = null,
): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO collections (user_id, name, description) VALUES ($1, $2, $3) RETURNING id`,
    [userId, name, description],
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
  await pool.query(`UPDATE collections SET is_public = $2 WHERE id = $1`, [collectionId, isPublic])
}

export async function deleteCollection(pool: DbPool, collectionId: number): Promise<void> {
  await pool.query(`DELETE FROM collections WHERE id = $1`, [collectionId])
}
