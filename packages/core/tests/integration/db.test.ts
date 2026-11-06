import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  findEnrichedRepos,
  findPendingRepos,
  findRepoByFullName,
  findReposForMatching,
  listReposMissingGithubId,
  migrate,
  saveSnapshot,
  searchEnrichedRepos,
  setRepoGithubId,
  updateEnrichment,
  upsertRepo,
  type DbPool,
} from '../../src/db.js'
import { createTestPool, dropTestDatabase, embedding, hasTestDatabase, repoInput, truncateAll } from './setup.js'

describe.skipIf(!hasTestDatabase)('database integration', () => {
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

  it('migrate 可以重复执行', async () => {
    if (!pool) throw new Error('pool 未初始化')
    await expect(migrate(pool)).resolves.toBeUndefined()
    const { rows } = await pool.query<{ version: string }>(
      `SELECT version FROM schema_migrations ORDER BY version`,
    )
    expect(rows.map((row) => row.version)).toEqual([
      '0001_initial',
      '0002_similar_reports',
      '0003_repo_github_id',
      '0004_prompt_versions',
      '0005_repo_translations',
      '0006_repos_enriched_quality',
      '0007_feed_snapshots',
      '0008_patch_kind',
      '0009_integration_impacts',
      '0010_code_chunks',
      '0011_impact_kind',
      '0012_code_chunk_symbol',
      '0014_repo_profiles',
      '0015_inferred_topics',
      '0016_daily_rankings',
      '0017_radar_snapshot_lifecycle',
      '0018_collection_public_slug',
      '0019_teams',
      '0020_team_collections',
      '0021_team_watch_intents',
      '0022_share_view_stats',
      '0023_team_project_shares',
      '0024_feed_snapshot_version',
      '0025_team_digest',
    ])
  })

  it('upsertRepo 在仓库改名后按 githubId 原地更新', async () => {
    if (!pool) throw new Error('pool 未初始化')
    const first = await upsertRepo(pool, repoInput({ githubId: 1001, stars: 10 }))
    expect(first.inserted).toBe(true)

    const renamed = await upsertRepo(
      pool,
      repoInput({ githubId: 1001, fullName: 'acme/radar-next', stars: 20 }),
    )
    expect(renamed).toEqual({ id: first.id, inserted: false })

    const { rows } = await pool.query<{ full_name: string; stars: number }>(
      `SELECT full_name, stars FROM repos WHERE id = $1`,
      [first.id],
    )
    expect(rows[0]).toMatchObject({ full_name: 'acme/radar-next', stars: 20 })
  })

  it('upsertRepo 用 full_name 兜底合并，并补上 githubId', async () => {
    if (!pool) throw new Error('pool 未初始化')
    const first = await upsertRepo(pool, repoInput())
    const merged = await upsertRepo(pool, repoInput({ githubId: 2002, stars: 150 }))
    expect(merged).toEqual({ id: first.id, inserted: false })

    const { rows } = await pool.query<{ github_id: string; stars: number }>(
      `SELECT github_id, stars FROM repos WHERE id = $1`,
      [first.id],
    )
    expect(Number(rows[0]?.github_id)).toBe(2002)
    expect(rows[0]?.stars).toBe(150)
  })

  it('saveSnapshot 同一天重复写入保持幂等', async () => {
    if (!pool) throw new Error('pool 未初始化')
    const { id } = await upsertRepo(pool, repoInput())
    await saveSnapshot(pool, id, 100)
    await saveSnapshot(pool, id, 120)

    const { rows } = await pool.query<{ count: string; stars: number }>(
      `SELECT count(*)::text AS count, max(stars) AS stars FROM star_snapshots WHERE repo_id = $1`,
      [id],
    )
    expect(rows[0]).toEqual({ count: '1', stars: 120 })
  })

  it('findEnrichedRepos 返回 embedding 与 7 天前星数', async () => {
    if (!pool) throw new Error('pool 未初始化')
    const { id } = await upsertRepo(pool, repoInput({ stars: 500 }))
    await updateEnrichment(pool, id, {
      summary: '面向 agent 的工具箱',
      problem: '缺少统一的工具调用层',
      audience: 'agent 开发者',
      verdict: 'watch',
      reason: '生态活跃',
      qualityScore: 0.82,
      qualityDetail: { signals: ['stars'] },
      readmeHash: 'sha-1',
      embedding: embedding(3),
    })
    await pool.query(
      `INSERT INTO star_snapshots (repo_id, captured_on, stars)
       VALUES ($1, CURRENT_DATE - INTERVAL '7 days', 480), ($1, CURRENT_DATE, 500)`,
      [id],
    )

    const repos = await findEnrichedRepos(pool, 10)
    expect(repos).toHaveLength(1)
    expect(repos[0]).toMatchObject({
      id,
      fullName: 'acme/radar',
      summary: '面向 agent 的工具箱',
      qualityScore: 0.82,
      stars7d: 480,
    })
    expect(repos[0]?.embedding).toHaveLength(1536)
    expect(repos[0]?.embedding?.[0]).toBeCloseTo(3 / 97, 5)

    const single = await findRepoByFullName(pool, 'acme/radar')
    expect(single?.embedding).toHaveLength(1536)
  })

  it('findEnrichedRepos 用 pgvector 预计算相似度并跳过向量传输', async () => {
    if (!pool) throw new Error('pool 未初始化')
    const vector = embedding(3)
    const { id } = await upsertRepo(pool, repoInput({ stars: 500 }))
    await updateEnrichment(pool, id, {
      summary: '面向 agent 的工具箱',
      problem: '',
      audience: '',
      verdict: 'watch',
      reason: '',
      qualityScore: 0.82,
      qualityDetail: {},
      readmeHash: null,
      embedding: vector,
    })

    const withoutSemantic = await findEnrichedRepos(pool, 10, { includeEmbedding: false })
    expect(withoutSemantic[0]?.embedding).toBeNull()
    expect(withoutSemantic[0]?.semanticScore).toBeUndefined()

    const same = await findEnrichedRepos(pool, 10, { profileEmbedding: vector })
    expect(same[0]?.embedding).toBeNull()
    expect(same[0]?.semanticScore).toBeCloseTo(1, 5)

    const other = Array.from({ length: 1536 }, (_, index) => (index % 2 === 0 ? 1 : 0))
    const different = await findEnrichedRepos(pool, 10, { profileEmbedding: other })
    expect(different[0]?.semanticScore).toBeLessThan(1)
    expect(different[0]?.semanticScore).toBeGreaterThanOrEqual(0)
  })

  it('findEnrichedRepos 的 language / verifiedOnly 在 SQL 里先过滤再取窗口', async () => {
    if (!pool) throw new Error('pool 未初始化')
    const ts = await upsertRepo(
      pool,
      repoInput({ fullName: 'acme/ts-tool', language: 'TypeScript', stars: 900 }),
    )
    const py = await upsertRepo(
      pool,
      repoInput({ fullName: 'acme/py-tool', language: 'Python', stars: 10 }),
    )
    for (const [id, qualityScore] of [
      [ts.id, 0.9],
      [py.id, 0.1],
    ] as const) {
      await updateEnrichment(pool, id, {
        summary: '工具',
        problem: '',
        audience: '',
        verdict: 'watch',
        reason: '',
        qualityScore,
        qualityDetail: {},
        readmeHash: null,
        embedding: null,
      })
    }
    await pool.query(`UPDATE repos SET verify_status = 'verified' WHERE id = $1`, [py.id])

    // limit=1 时如果先取窗口再过滤，Python 会被 TypeScript 挤掉。
    const onlyPython = await findEnrichedRepos(pool, 1, { language: 'Python' })
    expect(onlyPython.map((repo) => repo.fullName)).toEqual(['acme/py-tool'])

    const verified = await findEnrichedRepos(pool, 10, { verifiedOnly: true })
    expect(verified.map((repo) => repo.fullName)).toEqual(['acme/py-tool'])

    const unfiltered = await findEnrichedRepos(pool, 1)
    expect(unfiltered.map((repo) => repo.fullName)).toEqual(['acme/ts-tool'])
  })

  it('searchEnrichedRepos 按关键词、topic 和语言过滤', async () => {
    if (!pool) throw new Error('pool 未初始化')
    const agent = await upsertRepo(
      pool,
      repoInput({
        fullName: 'acme/agent-kit',
        topics: ['ai-agents', 'mcp'],
        language: 'TypeScript',
        description: 'agent runtime',
      }),
    )
    const data = await upsertRepo(
      pool,
      repoInput({
        fullName: 'acme/data-pipe',
        topics: ['data'],
        language: 'Python',
        description: 'pipeline',
      }),
    )
    for (const [id, summary] of [
      [agent.id, 'agent framework'],
      [data.id, 'data pipeline'],
    ] as const) {
      await updateEnrichment(pool, id, {
        summary,
        problem: '',
        audience: '',
        verdict: 'watch',
        reason: '',
        qualityScore: 0.5,
        qualityDetail: {},
        readmeHash: null,
        embedding: null,
      })
    }

    const byKeyword = await searchEnrichedRepos(pool, { query: 'agent', limit: 10 })
    expect(byKeyword.map((repo) => repo.fullName)).toEqual(['acme/agent-kit'])

    const byTopic = await searchEnrichedRepos(pool, { topic: 'data', limit: 10 })
    expect(byTopic.map((repo) => repo.fullName)).toEqual(['acme/data-pipe'])

    const byLanguage = await searchEnrichedRepos(pool, { language: 'typescript', limit: 10 })
    expect(byLanguage.map((repo) => repo.fullName)).toEqual(['acme/agent-kit'])
  })

  it('findPendingRepos 和 findReposForMatching 在列前缀后仍然可用', async () => {
    if (!pool) throw new Error('pool 未初始化')
    const pending = await upsertRepo(
      pool,
      repoInput({ fullName: 'acme/pending', topics: ['cli'], language: 'Go', stars: 50 }),
    )
    const enriched = await upsertRepo(
      pool,
      repoInput({ fullName: 'acme/enriched', topics: ['llm'], language: 'Python', stars: 10 }),
    )
    await updateEnrichment(pool, enriched.id, {
      summary: '已富化',
      problem: '',
      audience: '',
      verdict: 'watch',
      reason: '',
      qualityScore: 0.6,
      qualityDetail: {},
      readmeHash: null,
      embedding: null,
    })

    expect((await findPendingRepos(pool, 10)).map((repo) => repo.id)).toEqual([pending.id])
    expect(
      (await findReposForMatching(pool, { topics: ['llm'], limit: 10 })).map((repo) => repo.fullName),
    ).toEqual(['acme/enriched'])
    expect(
      (await findReposForMatching(pool, { keywords: ['pending'], limit: 10 })).map(
        (repo) => repo.fullName,
      ),
    ).toEqual(['acme/pending'])
  })

  it('listReposMissingGithubId 与 setRepoGithubId 配合补齐旧数据', async () => {
    if (!pool) throw new Error('pool 未初始化')
    const { id } = await upsertRepo(pool, repoInput())
    const missing = await listReposMissingGithubId(pool)
    expect(missing).toEqual([{ id, fullName: 'acme/radar' }])

    await setRepoGithubId(pool, id, 3003)
    expect(await listReposMissingGithubId(pool)).toEqual([])
  })
})
