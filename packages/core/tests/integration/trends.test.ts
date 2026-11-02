import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { DbPool } from '../../src/db.js'
import { loadTrendReport, saveTrendReport, type TrendReport } from '../../src/trends.js'
import { createTestPool, dropTestDatabase, hasTestDatabase, truncateAll } from './setup.js'

const report: TrendReport = {
  generatedAt: new Date().toISOString(),
  model: 'test-model',
  stats: {
    windowDays: 7,
    totalRepos: 3,
    risers: [
      { fullName: 'a/one', stars: 100, growth: 0.1, language: 'TypeScript', summary: '', topics: [] },
    ],
    topics: [{ topic: 'llm', repos: 2, growth: 0.08, stars: 300 }],
    newEntrants: [],
  },
  brief: {
    headline: 'LLM 继续领涨',
    points: [
      { title: '增长', detail: 'a/one 涨了 10%。', repos: ['a/one'] },
      { title: 'topic', detail: '#llm 平均涨 8%。', repos: [] },
    ],
    watch: ['观察'],
  },
}

describe.skipIf(!hasTestDatabase)('trend reports', () => {
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

  it('saves and loads the latest report', async () => {
    if (!pool) throw new Error('pool 未初始化')
    expect(await loadTrendReport(pool)).toBeNull()
    await saveTrendReport(pool, report)
    const loaded = await loadTrendReport(pool)
    expect(loaded?.brief.headline).toBe('LLM 继续领涨')
    expect(loaded?.stats.totalRepos).toBe(3)
  })
})
