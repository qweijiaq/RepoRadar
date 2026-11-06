import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildTasteProfile } from '../../src/personalize.js'
import { findUserById, ensureUser } from '../../src/users.js'
import { updateEnrichment, upsertRepo, type DbPool } from '../../src/db.js'
import {
  loadFeedSnapshot,
  loadFeedSnapshotPage,
  listUsersNeedingFeedSnapshot,
  refreshFeedSnapshot,
} from '../../src/feed-snapshots.js'
import { createTestPool, dropTestDatabase, hasTestDatabase, repoInput, truncateAll } from './setup.js'

describe.skipIf(!hasTestDatabase)('feed snapshots', () => {
  let pool: DbPool | undefined
  let userId = 0

  beforeAll(async () => {
    pool = await createTestPool()
  })

  afterAll(async () => {
    await pool?.end()
    await dropTestDatabase()
  })

  beforeEach(async () => {
    if (!pool) return
    await truncateAll(pool)
    userId = await ensureUser(pool, {
      login: 'snapshot-user',
      displayName: 'Snapshot User',
      avatarUrl: null,
      githubId: 7001,
    })
    const profile = buildTasteProfile({
      starred: [
        { topics: ['cli'], language: 'TypeScript', embedding: null },
        { topics: ['cli'], language: 'TypeScript', embedding: null },
      ],
    })
    await pool.query(`UPDATE users SET profile = $2::jsonb WHERE id = $1`, [
      userId,
      JSON.stringify(profile),
    ])
  })

  async function enrich(fullName: string, qualityScore: number): Promise<number> {
    if (!pool) throw new Error('pool 未初始化')
    const { id } = await upsertRepo(
      pool,
      repoInput({ fullName, topics: ['cli'], language: 'TypeScript' }),
    )
    await updateEnrichment(pool, id, {
      summary: fullName,
      problem: '',
      audience: '',
      verdict: 'watch',
      reason: '',
      qualityScore,
      qualityDetail: {},
      readmeHash: null,
      embedding: null,
    })
    return id
  }

  it('refreshFeedSnapshot 按分数排序并落库', async () => {
    if (!pool) throw new Error('pool 未初始化')
    const low = await enrich('acme/low', 0.2)
    const high = await enrich('acme/high', 0.9)
    const mid = await enrich('acme/mid', 0.5)

    const snapshot = await refreshFeedSnapshot(pool, userId)
    expect(snapshot?.ids).toEqual([high, mid, low])
    expect(snapshot?.poolSize).toBe(3)

    const loaded = await loadFeedSnapshot(pool, userId)
    expect(loaded?.ids).toEqual([high, mid, low])
  })

  it('loadFeedSnapshotPage 按快照顺序返回切片', async () => {
    if (!pool) throw new Error('pool 未初始化')
    const low = await enrich('acme/low', 0.2)
    const high = await enrich('acme/high', 0.9)
    const mid = await enrich('acme/mid', 0.5)
    await refreshFeedSnapshot(pool, userId)

    expect((await loadFeedSnapshotPage(pool, userId, 2))?.map((repo) => repo.id)).toEqual([high, mid])
    expect((await loadFeedSnapshotPage(pool, userId, 10))?.map((repo) => repo.id)).toEqual([
      high,
      mid,
      low,
    ])
  })

  it('过期快照会被忽略，页面回退到实时排名', async () => {
    if (!pool) throw new Error('pool 未初始化')
    await enrich('acme/one', 0.8)
    await refreshFeedSnapshot(pool, userId)
    await pool.query(
      `UPDATE feed_snapshots SET built_at = now() - INTERVAL '2 hours' WHERE user_id = $1`,
      [userId],
    )

    expect(await loadFeedSnapshot(pool, userId)).toBeNull()
    expect(await loadFeedSnapshotPage(pool, userId, 10)).toBeNull()
  })

  it('旧版本快照会被忽略并触发重建', async () => {
    if (!pool) throw new Error('pool 未初始化')
    await enrich('acme/versioned', 0.8)
    const snapshot = await refreshFeedSnapshot(pool, userId)
    expect(snapshot?.version).toBeTruthy()

    await pool.query(`UPDATE feed_snapshots SET version = 'legacy' WHERE user_id = $1`, [userId])
    expect(await loadFeedSnapshot(pool, userId)).toBeNull()
    expect(await listUsersNeedingFeedSnapshot(pool, 10)).toContain(userId)
  })

  it('没有画像的用户不会生成快照', async () => {
    if (!pool) throw new Error('pool 未初始化')
    const otherId = await ensureUser(pool, {
      login: 'no-profile',
      displayName: null,
      avatarUrl: null,
      githubId: 7002,
    })
    expect((await findUserById(pool, otherId))?.profile).toBeNull()
    expect(await refreshFeedSnapshot(pool, otherId)).toBeNull()
  })

  it('listUsersNeedingFeedSnapshot 覆盖有画像的用户', async () => {
    if (!pool) throw new Error('pool 未初始化')
    expect(await listUsersNeedingFeedSnapshot(pool, 10)).toContain(userId)
  })
})
