import { describe, expect, it } from 'vitest'
import { listAdminUserOverview } from '../src/admin-users.js'
import { isGithubTokenInvalid } from '../src/hidden-gems.js'
import type { DbPool } from '../src/db.js'

describe('listAdminUserOverview', () => {
  it('maps rows and clamps the limit', async () => {
    const calls: unknown[][] = []
    const pool = {
      query: async (_text: string, params?: unknown[]) => {
        calls.push(params ?? [])
        return {
          rows: [
            {
              id: '7',
              login: 'demo',
              name: 'Demo',
              email: 'demo@example.com',
              notification_email: null,
              created_at: new Date('2026-01-02T03:04:05Z'),
              stars_synced_at: '2026-01-03T00:00:00Z',
              topic_count: '4',
              jobs_total: '12',
              jobs_running: '1',
              jobs_failed: '2',
              tokens_30d: '1234',
              last_job_at: new Date('2026-01-04T00:00:00Z'),
            },
          ],
        }
      },
    } as unknown as DbPool

    const users = await listAdminUserOverview(pool, 10_000)
    expect(calls[0]?.[0]).toBe(1000)
    expect(users).toHaveLength(1)
    expect(users[0]).toMatchObject({
      id: 7,
      login: 'demo',
      topicCount: 4,
      jobsTotal: 12,
      jobsRunning: 1,
      jobsFailed: 2,
      tokens30d: 1234,
      starsSyncedAt: '2026-01-03T00:00:00Z',
      lastJobAt: '2026-01-04T00:00:00.000Z',
    })
    expect(users[0]?.createdAt).toBe('2026-01-02T03:04:05.000Z')
  })
})

describe('isGithubTokenInvalid', () => {
  it('returns false for missing or unknown tokens', () => {
    expect(isGithubTokenInvalid(null)).toBe(false)
    expect(isGithubTokenInvalid('ghp_never_seen')).toBe(false)
  })
})
