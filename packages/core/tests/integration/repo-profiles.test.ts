import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { DbPool } from '../../src/db.js'
import { loadRepoProfile, saveRepoProfile } from '../../src/repo-profile.js'
import { createTestPool, dropTestDatabase, hasTestDatabase, truncateAll } from './setup.js'

const profile = {
  positioning: '一个把命令行参数解析成结构化对象的轻量库。',
  features: [
    { name: '参数解析', detail: '支持短选项、长选项和默认值。' },
    { name: '类型推导', detail: '返回带类型的解析结果。' },
    { name: '错误提示', detail: '参数缺失时给出可读错误。' },
  ],
  useCases: ['写 Node CLI'],
  notFor: ['复杂子命令'],
  quickstart: ['npm i arg'],
}

describe.skipIf(!hasTestDatabase)('repo profiles', () => {
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

  it('saves and loads a profile, updating in place', async () => {
    if (!pool) throw new Error('pool 未初始化')
    expect(await loadRepoProfile(pool, 'vercel/arg')).toBeNull()

    await saveRepoProfile(pool, 'vercel/arg', profile, { model: 'test-model', sourceHash: 'abc' })
    const loaded = await loadRepoProfile(pool, 'vercel/arg')
    expect(loaded).toMatchObject({
      repoFullName: 'vercel/arg',
      positioning: profile.positioning,
      features: profile.features,
      useCases: profile.useCases,
      notFor: profile.notFor,
      quickstart: profile.quickstart,
      model: 'test-model',
      sourceHash: 'abc',
    })

    await saveRepoProfile(
      pool,
      'vercel/arg',
      { ...profile, positioning: '更新后的定位说明，用于测试覆盖。' },
      { model: 'test-model-2', sourceHash: 'def' },
    )
    const updated = await loadRepoProfile(pool, 'vercel/arg')
    expect(updated?.positioning).toContain('更新后')
    expect(updated?.sourceHash).toBe('def')
  })
})
