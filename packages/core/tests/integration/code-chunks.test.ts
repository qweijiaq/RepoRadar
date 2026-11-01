import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DbPool } from '../../src/db.js'
import { countCodeChunks, indexRepoCode, searchCodeChunks } from '../../src/code-index.js'
import { createTestPool, dropTestDatabase, hasTestDatabase, truncateAll } from './setup.js'

function stubGitHub(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/git/trees/HEAD')) {
        return new Response(
          JSON.stringify({
            tree: [
              { path: 'README.md', type: 'blob' },
              { path: 'src/index.ts', type: 'blob' },
              { path: 'node_modules/dep/index.js', type: 'blob' },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      if (url.endsWith('/contents/README.md')) {
        return new Response('# Demo\n\nA demo project with widgets.')
      }
      if (url.endsWith('/contents/src/index.ts')) {
        return new Response('export function main() { return 1 }')
      }
      return new Response('', { status: 404 })
    }),
  )
}

describe.skipIf(!hasTestDatabase)('code chunks', () => {
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

  it('索引入口文件、跳过 node_modules，重建时替换旧数据', async () => {
    if (!pool) throw new Error('pool 未初始化')
    stubGitHub()

    const first = await indexRepoCode(pool, 'acme/app', { maxFiles: 5 })
    expect(first.files).toBe(2)
    expect(first.embedded).toBe(0)
    expect(await countCodeChunks(pool, 'acme/app')).toBe(first.chunks)

    const again = await indexRepoCode(pool, 'acme/app', { maxFiles: 5 })
    expect(await countCodeChunks(pool, 'acme/app')).toBe(again.chunks)

    const chunks = await searchCodeChunks(pool, 'acme/app', 'main function')
    expect(chunks.some((chunk) => chunk.path === 'src/index.ts')).toBe(true)
  })

  it('没有关键词时返回空结果', async () => {
    if (!pool) throw new Error('pool 未初始化')
    expect(await searchCodeChunks(pool, 'acme/app', '  ')).toEqual([])
  })
})
