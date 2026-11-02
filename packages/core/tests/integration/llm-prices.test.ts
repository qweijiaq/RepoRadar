import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { DbPool } from '../../src/db.js'
import {
  clearLlmPrices,
  loadLlmPrices,
  loadUsageByModel,
  saveLlmPrices,
} from '../../src/llm-prices.js'
import { recordLlmUsageRows } from '../../src/usage.js'
import { ensureUser } from '../../src/users.js'
import { createTestPool, dropTestDatabase, hasTestDatabase, truncateAll } from './setup.js'

describe.skipIf(!hasTestDatabase)('llm prices', () => {
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
      login: 'price-user',
      displayName: 'Price User',
      avatarUrl: null,
      githubId: 9201,
    })
  })

  it('保存、读取并清空单价', async () => {
    if (!pool) throw new Error('pool 未初始化')
    expect(await loadLlmPrices(pool)).toEqual({})

    await saveLlmPrices(pool, {
      'deepseek-flash': { input: 0.14, output: 0.28 },
      broken: { input: -1, output: 1 },
    } as never)
    expect(await loadLlmPrices(pool)).toEqual({ 'deepseek-flash': { input: 0.14, output: 0.28 } })

    await clearLlmPrices(pool)
    expect(await loadLlmPrices(pool)).toEqual({})
  })

  it('按模型聚合近 30 天用量', async () => {
    if (!pool) throw new Error('pool 未初始化')
    await recordLlmUsageRows(pool, userId, null, 'comparison', [
      { providerId: null, model: 'model-a', promptTokens: 100, completionTokens: 10, latencyMs: 100 },
    ])
    await recordLlmUsageRows(pool, userId, null, 'comparison', [
      { providerId: null, model: 'model-a', promptTokens: 200, completionTokens: 20, latencyMs: 200 },
    ])
    await recordLlmUsageRows(pool, userId, null, 'swap-trial', [
      { providerId: null, model: 'model-b', promptTokens: 50, completionTokens: 5, latencyMs: 50 },
    ])

    const usage = await loadUsageByModel(pool, 30)
    const a = usage.find((row) => row.model === 'model-a')
    expect(a).toMatchObject({ calls: 2, promptTokens: 300, completionTokens: 30 })
    expect(usage.find((row) => row.model === 'model-b')).toMatchObject({ calls: 1, promptTokens: 50 })
  })
})
