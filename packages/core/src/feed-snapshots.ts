import { findEnrichedRepos, findEnrichedReposByIds, type DbPool } from './db.js'
import { diversifyRanking } from './diversity.js'
import { listFeedbackSignals, loadFeedback } from './feedback.js'
import { buildFeedbackContext, rankForUser } from './personalize.js'
import { loadSubscriptions } from './subscriptions.js'
import type { EnrichedRepoRecord } from './types.js'
import { findUserById } from './users.js'
import { SCORING_VERSION } from './versions.js'

/** 一次预计算保留多少个排名结果，作为「加载更多」的上限。 */
export const FEED_SNAPSHOT_LIMIT = 300

/** 超过这个时间的快照视为过期，页面会回退到实时排名并触发重建。 */
export const FEED_SNAPSHOT_MAX_AGE_MINUTES = 60

/** 快照结构版本；修改 ids 语义或排序输入时需要递增。 */
export const FEED_SNAPSHOT_SCHEMA_VERSION = 2

export const FEED_SNAPSHOT_VERSION = `${SCORING_VERSION}:snapshot-v${FEED_SNAPSHOT_SCHEMA_VERSION}`

export interface FeedSnapshot {
  userId: number
  ids: number[]
  poolSize: number
  version: string
  builtAt: string
}

interface FeedSnapshotRow {
  user_id: string
  ids: Array<string | number>
  pool_size: number
  version: string
  built_at: Date | string
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value
}

export async function loadFeedSnapshot(
  pool: DbPool,
  userId: number,
  maxAgeMinutes: number = FEED_SNAPSHOT_MAX_AGE_MINUTES,
): Promise<FeedSnapshot | null> {
  const { rows } = await pool.query<FeedSnapshotRow>(
    `SELECT user_id, ids, pool_size, version, built_at
     FROM feed_snapshots
     WHERE user_id = $1
       AND built_at > now() - ($2::int * INTERVAL '1 minute')
       AND version = $3
     LIMIT 1`,
    [userId, Math.max(1, maxAgeMinutes), FEED_SNAPSHOT_VERSION],
  )
  const row = rows[0]
  if (!row) return null
  return {
    userId: Number(row.user_id),
    ids: row.ids.map((id) => Number(id)),
    poolSize: row.pool_size,
    version: row.version,
    builtAt: toIso(row.built_at),
  }
}

/** 用户反馈、偏好或订阅变化后，让下一次 feed 重新取实时排名。 */
export async function invalidateFeedSnapshot(pool: DbPool, userId: number): Promise<void> {
  await pool.query(`DELETE FROM feed_snapshots WHERE user_id = $1`, [userId])
}

export async function saveFeedSnapshot(
  pool: DbPool,
  userId: number,
  ids: number[],
  poolSize: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO feed_snapshots (user_id, ids, pool_size, version, built_at)
     VALUES ($1, $2::bigint[], $3, $4, now())
     ON CONFLICT (user_id) DO UPDATE SET
       ids = EXCLUDED.ids,
       pool_size = EXCLUDED.pool_size,
       version = EXCLUDED.version,
       built_at = now()`,
    [userId, ids, poolSize, FEED_SNAPSHOT_VERSION],
  )
}

/**
 * 用和 feed 实时排名相同的数据与公式重算一次主列表，并落库。
 * 没有画像的用户直接跳过。
 */
export async function refreshFeedSnapshot(pool: DbPool, userId: number): Promise<FeedSnapshot | null> {
  const user = await findUserById(pool, userId)
  const profile = user?.profile
  if (!profile || profile.starredCount === 0) return null

  const [repos, feedback, signals, subscriptions] = await Promise.all([
    // 列表不需要向量：相似度由 pgvector 在库里算。
    findEnrichedRepos(pool, 500, { profileEmbedding: profile.embedding, includeEmbedding: false }),
    loadFeedback(pool, userId),
    listFeedbackSignals(pool, userId),
    loadSubscriptions(pool, userId),
  ])
  if (repos.length === 0) return null

  const context = buildFeedbackContext(feedback, signals)
  const ranked = rankForUser(profile, repos, Date.now(), context, subscriptions)
  const diversified = diversifyRanking(ranked, { limit: FEED_SNAPSHOT_LIMIT })
  const ids = diversified.map((repo) => repo.id)
  if (ids.length === 0) return null

  await saveFeedSnapshot(pool, userId, ids, repos.length)
  return {
    userId,
    ids,
    poolSize: repos.length,
    version: FEED_SNAPSHOT_VERSION,
    builtAt: new Date().toISOString(),
  }
}

/**
 * 按快照顺序取一页仓库。快照缺失或过期时返回 null，调用方回退到实时排名。
 */
export async function loadFeedSnapshotPage(
  pool: DbPool,
  userId: number,
  limit: number,
  options: { profileEmbedding?: number[] | null } = {},
): Promise<EnrichedRepoRecord[] | null> {
  const snapshot = await loadFeedSnapshot(pool, userId)
  if (!snapshot || snapshot.ids.length === 0) return null

  const ids = snapshot.ids.slice(0, Math.max(1, limit))
  const repos = await findEnrichedReposByIds(pool, ids, {
    profileEmbedding: options.profileEmbedding ?? null,
    includeEmbedding: false,
  })
  const byId = new Map(repos.map((repo) => [repo.id, repo]))
  const page = ids
    .map((id) => byId.get(id))
    .filter((repo): repo is EnrichedRepoRecord => Boolean(repo))
  return page.length > 0 ? page : null
}

/** 按快照时间从旧到新挑出需要重建的用户，供 worker 轮转。 */
export async function listUsersNeedingFeedSnapshot(pool: DbPool, limit = 20): Promise<number[]> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT u.id
     FROM users u
     LEFT JOIN feed_snapshots s ON s.user_id = u.id AND s.version = $2
     WHERE u.profile IS NOT NULL
     ORDER BY s.built_at ASC NULLS FIRST
     LIMIT $1`,
    [Math.max(1, Math.min(200, limit)), FEED_SNAPSHOT_VERSION],
  )
  return rows.map((row) => Number(row.id))
}
