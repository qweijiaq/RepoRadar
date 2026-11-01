import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DbPool } from '../../src/db.js'
import {
  checkIntegrationImpacts,
  listIntegrationImpacts,
  recordIntegrationImpact,
} from '../../src/integration-impacts.js'
import { ensureUser } from '../../src/users.js'
import { createTestPool, dropTestDatabase, hasTestDatabase, truncateAll } from './setup.js'

function releaseResponse(publishedAt: string): Response {
  return new Response(
    JSON.stringify({
      tag_name: 'v2.0.0',
      name: 'Zod 2',
      html_url: 'https://github.com/colinhacks/zod/releases/tag/v2.0.0',
      published_at: publishedAt,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

describe.skipIf(!hasTestDatabase)('integration impacts', () => {
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
      login: 'impact-user',
      displayName: null,
      avatarUrl: null,
      githubId: 9001,
    })
    await pool.query(
      `INSERT INTO integration_outcomes (user_id, project_full_name, suggestion_repo, status)
       VALUES ($1, 'acme/app', 'colinhacks/zod', 'adopted')`,
      [userId],
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('只回访接入之后发布的新版本，且同一版本只记一次', async () => {
    if (!pool) throw new Error('pool 未初始化')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => releaseResponse(new Date(Date.now() + 3_600_000).toISOString())),
    )

    expect(await checkIntegrationImpacts(pool, { limit: 5 })).toBe(1)
    expect(await checkIntegrationImpacts(pool, { limit: 5 })).toBe(0)

    const impacts = await listIntegrationImpacts(pool, userId, 5)
    expect(impacts).toHaveLength(1)
    expect(impacts[0]).toMatchObject({
      projectFullName: 'acme/app',
      suggestionRepo: 'colinhacks/zod',
      version: 'v2.0.0',
    })

    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM notifications WHERE user_id = $1`,
      [userId],
    )
    expect(rows[0]?.count).toBe('1')
  })

  it('记录 OSV 安全公告', async () => {
    if (!pool) throw new Error('pool 未初始化')
    await pool.query(`DELETE FROM integration_outcomes WHERE user_id = $1`, [userId])
    await pool.query(
      `INSERT INTO integration_outcomes (user_id, project_full_name, suggestion_repo, status)
       VALUES ($1, 'acme/app', 'acme/vuln-lib', 'adopted')`,
      [userId],
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input)
        if (url.includes('api.osv.dev')) {
          return new Response(
            JSON.stringify({ vulns: [{ id: 'GHSA-1', summary: 'prototype pollution' }] }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        }
        return new Response('', { status: 404 })
      }),
    )

    expect(await checkIntegrationImpacts(pool, { limit: 5 })).toBe(1)
    const impacts = await listIntegrationImpacts(pool, userId, 5)
    expect(impacts[0]).toMatchObject({ kind: 'advisory', version: 'osv:GHSA-1' })
  })

  it('接入之前发布的版本不会回访', async () => {
    if (!pool) throw new Error('pool 未初始化')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => releaseResponse(new Date(Date.now() - 86_400_000).toISOString())),
    )

    expect(await checkIntegrationImpacts(pool, { limit: 5 })).toBe(0)
    expect(await listIntegrationImpacts(pool, userId, 5)).toEqual([])
  })

  it('重复写入同版本不会产生第二条记录', async () => {
    if (!pool) throw new Error('pool 未初始化')
    const input = {
      userId,
      projectFullName: 'acme/app',
      suggestionRepo: 'colinhacks/zod',
      version: 'v9.9.9',
      title: 'release',
      url: null,
      publishedAt: null,
    }
    expect(await recordIntegrationImpact(pool, input)).toBe(true)
    expect(await recordIntegrationImpact(pool, input)).toBe(false)
    expect(await listIntegrationImpacts(pool, userId, 5)).toHaveLength(1)
  })
})
