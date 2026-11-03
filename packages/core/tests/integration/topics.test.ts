import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { DbPool } from '../../src/db.js'
import { findEnrichedRepos, updateEnrichment, upsertRepo } from '../../src/db.js'
import { listReposNeedingTopics, saveInferredTopics } from '../../src/topics.js'
import { createTestPool, dropTestDatabase, hasTestDatabase, truncateAll } from './setup.js'

describe.skipIf(!hasTestDatabase)('inferred topics', () => {
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

  it('saves inferred topics without touching GitHub topics and finds repos missing them', async () => {
    if (!pool) throw new Error('pool 未初始化')
    const { id } = await upsertRepo(pool, {
      fullName: 'acme/no-topics',
      owner: 'acme',
      name: 'no-topics',
      description: 'A CLI without topics',
      htmlUrl: 'https://github.com/acme/no-topics',
      homepage: null,
      language: 'TypeScript',
      topics: [],
      stars: 100,
      forks: 0,
      openIssues: 0,
      license: 'MIT',
      archived: false,
      isFork: false,
      pushedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    })
    await updateEnrichment(pool, id, {
      summary: '一个没有 topic 的 CLI',
      problem: '',
      audience: '',
      verdict: 'recommend',
      reason: '',
      qualityScore: 0.8,
      qualityDetail: {},
      readmeHash: null,
      embedding: null,
    })

    expect((await listReposNeedingTopics(pool, 10)).map((repo) => repo.fullName)).toContain(
      'acme/no-topics',
    )

    await saveInferredTopics(pool, 'acme/no-topics', ['CLI Tool', 'nodejs'])
    const repos = await findEnrichedRepos(pool, 10)
    const saved = repos.find((repo) => repo.fullName === 'acme/no-topics')
    expect(saved?.topics).toEqual([])
    expect(saved?.inferredTopics).toEqual(['cli-tool', 'nodejs'])
    expect(await listReposNeedingTopics(pool, 10)).toHaveLength(0)
  })
})
