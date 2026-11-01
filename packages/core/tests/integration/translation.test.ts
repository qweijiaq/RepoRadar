import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DbPool } from '../../src/db.js'
import { loadRepoTranslations, translationKey, warmRepoTranslations } from '../../src/translation.js'
import { createTestPool, dropTestDatabase, hasTestDatabase, truncateAll } from './setup.js'

const config = {
  apiKey: 'test-key',
  baseUrl: 'https://example.invalid/v1',
  model: 'test-model',
  embeddingModel: 'test-embedding',
}

const WARM_TEXT = 'A small CLI toolkit for building terminal dashboards and reusable widgets.'
const DB_TEXT =
  'A different toolkit that renders dashboards from structured event streams in real time.'

describe.skipIf(!hasTestDatabase)('translation cache', () => {
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

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('warmRepoTranslations 会把结果落库', async () => {
    if (!pool) throw new Error('pool 未初始化')
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      translations: ['一个用于构建终端仪表盘的小型 CLI 工具，支持插件和主题。'],
                    }),
                  },
                },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ),
    )

    expect(await warmRepoTranslations(pool, config, [WARM_TEXT])).toBe(1)

    const { rows } = await pool.query<{ source: string; translated: string }>(
      `SELECT source, translated FROM repo_translations`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.source).toBe(WARM_TEXT)
    expect(rows[0]?.translated).toContain('终端仪表盘')
  })

  it('loadRepoTranslations 会读回落库的翻译', async () => {
    if (!pool) throw new Error('pool 未初始化')
    await pool.query(
      `INSERT INTO repo_translations (source_hash, source, translated) VALUES ($1, $2, $3)`,
      [translationKey(DB_TEXT), DB_TEXT, '一个实时渲染仪表盘的工具栏。'],
    )

    const loaded = await loadRepoTranslations(pool, [DB_TEXT])
    expect(loaded.get(DB_TEXT)).toBe('一个实时渲染仪表盘的工具栏。')
  })

  it('中文和短文本不会触发模型调用', async () => {
    if (!pool) throw new Error('pool 未初始化')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const texts = ['一个用于构建终端仪表盘的小型 CLI 工具。', 'tiny']

    expect(await loadRepoTranslations(pool, texts)).toEqual(new Map())
    expect(await warmRepoTranslations(pool, config, texts)).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
