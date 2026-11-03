import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { DbPool } from '../../src/db.js'
import {
  listDailyRankingDates,
  loadDailyRanking,
  loadPersistedDailyRanking,
  persistDailyRanking,
  recordDailySnapshots,
} from '../../src/daily.js'
import { updateEnrichment, upsertRepo } from '../../src/db.js'
import { createTestPool, dropTestDatabase, hasTestDatabase, truncateAll } from './setup.js'

async function seedRepo(pool: DbPool, fullName: string, stars: number): Promise<number> {
  const [owner, name] = fullName.split('/')
  const { id } = await upsertRepo(pool, {
    fullName,
    owner: owner!,
    name: name!,
    description: 'test',
    htmlUrl: `https://github.com/${fullName}`,
    homepage: null,
    language: 'TypeScript',
    topics: ['test'],
    stars,
    forks: 0,
    openIssues: 0,
    license: 'MIT',
    archived: false,
    isFork: false,
    pushedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  })
  await updateEnrichment(pool, id, {
    summary: 'test repo',
    problem: '',
    audience: '',
    verdict: 'recommend',
    reason: '',
    qualityScore: 0.8,
    qualityDetail: {},
    readmeHash: null,
    embedding: null,
  })
  return id
}

describe.skipIf(!hasTestDatabase)('daily ranking', () => {
  let pool: DbPool | undefined

  beforeAll(async () => {
    pool = await createTestPool()
  })

  afterAll(async () => {
    await pool?.end()
    await dropTestDatabase()
  })

  beforeEach(async () => {
    if (pool) await truncateAll(pool)
  })

  it('ranks by gain vs the previous snapshot and marks day basis', async () => {
    if (!pool) throw new Error('pool 未初始化')
    const id = await seedRepo(pool, 'a/one', 120)
    await pool.query(
      `INSERT INTO star_snapshots (repo_id, captured_on, stars) VALUES ($1, CURRENT_DATE - 1, 100)`,
      [id],
    )
    const ranking = await loadDailyRanking(pool, 10)
    expect(ranking.basis).toBe('day')
    expect(ranking.items[0]).toMatchObject({ fullName: 'a/one', gain: 20, previousStars: 100 })
  })

  it('marks multi-day when the previous snapshot is older', async () => {
    if (!pool) throw new Error('pool 未初始化')
    const id = await seedRepo(pool, 'a/old', 150)
    await pool.query(
      `INSERT INTO star_snapshots (repo_id, captured_on, stars) VALUES ($1, CURRENT_DATE - 7, 100)`,
      [id],
    )
    const ranking = await loadDailyRanking(pool, 10)
    expect(ranking.basis).toBe('multi-day')
    expect(ranking.items[0]?.gain).toBe(50)
  })

  it('records today snapshots idempotently', async () => {
    if (!pool) throw new Error('pool 未初始化')
    await seedRepo(pool, 'a/snap', 80)
    await recordDailySnapshots(pool)
    await recordDailySnapshots(pool)
    const { rows } = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM star_snapshots WHERE captured_on = CURRENT_DATE`,
    )
    expect(rows[0]?.count).toBe(1)
  })
})

describe.skipIf(!hasTestDatabase)('daily ranking filters and persistence', () => {
  let pool: DbPool | undefined

  beforeAll(async () => {
    pool = await createTestPool()
  })

  afterAll(async () => {
    await pool?.end()
    await dropTestDatabase()
  })

  beforeEach(async () => {
    if (pool) await truncateAll(pool)
  })

  it('excludes official frameworks by default and can include them', async () => {
    if (!pool) throw new Error('pool 未初始化')
    const official = await seedRepo(pool, 'vercel/next.js', 120)
    const indie = await seedRepo(pool, 'morluto/rea', 80)
    for (const [id, stars] of [
      [official, 100],
      [indie, 50],
    ] as const) {
      await pool.query(
        `INSERT INTO star_snapshots (repo_id, captured_on, stars) VALUES ($1, CURRENT_DATE - 1, $2)`,
        [id, stars],
      )
    }

    const filtered = await loadDailyRanking(pool, 10)
    expect(filtered.items.map((item) => item.fullName)).toEqual(['morluto/rea'])
    const all = await loadDailyRanking(pool, 10, { includeOfficial: true })
    expect(all.items.map((item) => item.fullName)).toContain('vercel/next.js')
  })

  it('persists the ranking and loads it by date', async () => {
    if (!pool) throw new Error('pool 未初始化')
    const id = await seedRepo(pool, 'acme/one', 90)
    await pool.query(
      `INSERT INTO star_snapshots (repo_id, captured_on, stars) VALUES ($1, CURRENT_DATE - 1, 50)`,
      [id],
    )
    expect(await persistDailyRanking(pool)).toBeGreaterThan(0)

    const dates = await listDailyRankingDates(pool, 5)
    expect(dates).toHaveLength(1)
    const loaded = await loadPersistedDailyRanking(pool, dates[0]!)
    expect(loaded?.persisted).toBe(true)
    expect(loaded?.items[0]?.fullName).toBe('acme/one')
  })
})
