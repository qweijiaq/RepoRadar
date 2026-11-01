import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { DbPool } from '../../src/db.js'
import { findPatchDraft, savePatchDraft } from '../../src/patch.js'
import { ensureUser } from '../../src/users.js'
import { createTestPool, dropTestDatabase, hasTestDatabase, truncateAll } from './setup.js'

describe.skipIf(!hasTestDatabase)('patch drafts', () => {
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
      login: 'patch-user',
      displayName: null,
      avatarUrl: null,
      githubId: 8001,
    })
  })

  it('默认保存为 issue，接入预演保存为 integration', async () => {
    if (!pool) throw new Error('pool 未初始化')
    const base = {
      repo: 'acme/app',
      issueNumber: null,
      summary: '试接入',
      patch: 'diff --git a/package.json b/package.json\n',
      files: ['package.json'],
      validation: null,
      status: 'draft' as const,
    }

    const issueId = await savePatchDraft(pool, userId, { ...base, title: '修复补丁' })
    expect((await findPatchDraft(pool, userId, issueId))?.kind).toBe('issue')

    const trialId = await savePatchDraft(pool, userId, {
      ...base,
      kind: 'integration',
      title: '接入预演',
    })
    const trial = await findPatchDraft(pool, userId, trialId)
    expect(trial?.kind).toBe('integration')
    expect(trial?.title).toBe('接入预演')
    expect(trial?.files).toEqual(['package.json'])
  })
})
