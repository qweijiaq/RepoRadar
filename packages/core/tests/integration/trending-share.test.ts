import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { DbPool } from '../../src/db.js'
import { loadTrendingCopy, saveTrendingCopy } from '../../src/trending.js'
import { createTestPool, dropTestDatabase, hasTestDatabase, truncateAll } from './setup.js'

describe.skipIf(!hasTestDatabase)('trending share cache', () => {
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

  it('saves and loads a copy per day', async () => {
    if (!pool) throw new Error('pool 未初始化')
    expect(await loadTrendingCopy(pool, '2026-11-03')).toBeNull()
    await saveTrendingCopy(
      pool,
      '2026-11-03',
      {
        headline: 'zod 断层第一',
        intro: '本周 TypeScript 工具最猛',
        lines: { 'colinhacks/zod': '类型校验首选' },
        hashtags: ['GitHub', '开源'],
      },
      { model: 'deepseek-chat', generatedAt: new Date().toISOString() },
    )
    const loaded = await loadTrendingCopy(pool, '2026-11-03')
    expect(loaded?.copy.headline).toBe('zod 断层第一')
    expect(loaded?.model).toBe('deepseek-chat')
    expect(await loadTrendingCopy(pool, '2026-11-04')).toBeNull()
  })
})
