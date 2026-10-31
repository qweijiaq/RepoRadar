import type { DbPool } from './db.js'

export interface AccountExport {
  version: 1
  exportedAt: string
  user: Record<string, unknown>
  stars: unknown[]
  feedback: unknown[]
  subscriptions: unknown[]
  signals: unknown[]
  issueDrafts: unknown[]
  collections: Array<Record<string, unknown> & { items: unknown[] }>
  notifications: unknown[]
  projects: unknown[]
  integrationReports: unknown[]
  maintainerReports: unknown[]
  discoverabilityReports: unknown[]
  comparisonReports: unknown[]
  watch: { intents: unknown[]; matches: unknown[]; runs: unknown[] }
  integrationOutcomes: unknown[]
  issuePlans: unknown[]
  feed: { dismissals: unknown[]; statuses: unknown[]; impressions: unknown[] }
  jobs: unknown[]
  copilot: Array<Record<string, unknown> & { messages: unknown[] }>
  activity: { syncState: unknown[]; seen: unknown[] }
  llmUsage: unknown[]
  radarSnapshots: unknown[]
  deliveries: unknown[]
  patches: unknown[]
  pushSubscriptions: { count: number; note: string }
  githubTokenConnected: boolean
}

export function redactJobPayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {}
  const { token: _token, ...rest } = payload as Record<string, unknown>
  return rest
}

async function rows<T = Record<string, unknown>>(pool: DbPool, sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool.query(sql, params)
  return result.rows as T[]
}

export async function exportUserData(pool: DbPool, userId: number): Promise<AccountExport | null> {
  const users = await rows(pool, `SELECT * FROM users WHERE id = $1 LIMIT 1`, [userId])
  const user = users[0]
  if (!user) return null

  const [
    stars,
    feedback,
    subscriptions,
    signals,
    issueDrafts,
    collections,
    notifications,
    projects,
    integrationReports,
    maintainerReports,
    discoverabilityReports,
    comparisonReports,
    watchIntents,
    integrationOutcomes,
    issuePlans,
    feedDismissals,
    feedStatuses,
    feedImpressions,
    jobs,
    copilotThreads,
    activitySyncState,
    activitySeen,
    llmUsage,
    radarSnapshots,
    deliveries,
    patches,
    pushCount,
    githubTokens,
  ] = await Promise.all([
    rows(pool, `SELECT repo_full_name, starred_at FROM user_stars WHERE user_id = $1 ORDER BY starred_at DESC`, [userId]),
    rows(pool, `SELECT repo_full_name, kind, created_at FROM feedback WHERE user_id = $1 ORDER BY created_at DESC`, [userId]),
    rows(pool, `SELECT kind, value, created_at FROM subscriptions WHERE user_id = $1 ORDER BY created_at`, [userId]),
    rows(pool, `SELECT repo_full_name, source, weight, seen_at FROM user_signals WHERE user_id = $1 ORDER BY seen_at DESC`, [userId]),
    rows(pool, `SELECT * FROM issue_drafts WHERE user_id = $1 ORDER BY created_at DESC`, [userId]),
    rows(pool, `SELECT * FROM collections WHERE user_id = $1 ORDER BY created_at DESC`, [userId]),
    rows(pool, `SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC`, [userId]),
    rows(pool, `SELECT * FROM user_projects WHERE user_id = $1 ORDER BY created_at DESC`, [userId]),
    rows(pool, `SELECT * FROM integration_reports WHERE user_id = $1 ORDER BY created_at DESC`, [userId]),
    rows(pool, `SELECT * FROM maintainer_reports WHERE user_id = $1 ORDER BY created_at DESC`, [userId]),
    rows(pool, `SELECT * FROM discoverability_reports WHERE user_id = $1 ORDER BY created_at DESC`, [userId]),
    rows(pool, `SELECT * FROM comparison_reports WHERE user_id = $1 ORDER BY created_at DESC`, [userId]),
    rows(pool, `SELECT * FROM watch_intents WHERE user_id = $1 ORDER BY created_at DESC`, [userId]),
    rows(pool, `SELECT * FROM integration_outcomes WHERE user_id = $1 ORDER BY updated_at DESC`, [userId]),
    rows(pool, `SELECT * FROM issue_plans WHERE user_id = $1 ORDER BY created_at DESC`, [userId]),
    rows(pool, `SELECT * FROM feed_dismissals WHERE user_id = $1 ORDER BY created_at DESC`, [userId]),
    rows(pool, `SELECT * FROM feed_statuses WHERE user_id = $1 ORDER BY updated_at DESC`, [userId]),
    rows(pool, `SELECT * FROM feed_impressions WHERE user_id = $1 ORDER BY last_seen_at DESC`, [userId]),
    rows(pool, `SELECT * FROM ai_jobs WHERE user_id = $1 ORDER BY created_at DESC`, [userId]),
    rows(pool, `SELECT * FROM copilot_threads WHERE user_id = $1 ORDER BY updated_at DESC`, [userId]),
    rows(pool, `SELECT * FROM activity_sync_state WHERE user_id = $1`, [userId]),
    rows(pool, `SELECT * FROM activity_seen WHERE user_id = $1 ORDER BY seen_at DESC`, [userId]),
    rows(pool, `SELECT * FROM llm_usage WHERE user_id = $1 ORDER BY created_at DESC`, [userId]),
    rows(pool, `SELECT * FROM radar_snapshots WHERE user_id = $1 ORDER BY created_at DESC`, [userId]),
    rows(pool, `SELECT * FROM delivery_queue WHERE user_id = $1 ORDER BY created_at DESC`, [userId]),
    rows(pool, `SELECT * FROM patch_drafts WHERE user_id = $1 ORDER BY created_at DESC`, [userId]),
    pool.query<{ count: string }>(`SELECT count(*) FROM push_subscriptions WHERE user_id = $1`, [userId]),
    rows(pool, `SELECT 1 FROM github_tokens WHERE user_id = $1 LIMIT 1`, [userId]),
  ])

  const collectionIds = collections.map((collection) => Number(collection.id)).filter(Number.isFinite)
  const collectionItems = collectionIds.length
    ? await rows(pool, `SELECT * FROM collection_items WHERE collection_id = ANY($1::bigint[]) ORDER BY added_at`, [collectionIds])
    : []
  const intentIds = watchIntents.map((intent) => Number(intent.id)).filter(Number.isFinite)
  const [watchMatches, watchRuns] = intentIds.length
    ? await Promise.all([
        rows(pool, `SELECT * FROM watch_matches WHERE intent_id = ANY($1::bigint[]) ORDER BY created_at`, [intentIds]),
        rows(pool, `SELECT * FROM watch_runs WHERE intent_id = ANY($1::bigint[]) ORDER BY created_at`, [intentIds]),
      ])
    : [[], []]
  const threadIds = copilotThreads.map((thread) => Number(thread.id)).filter(Number.isFinite)
  const copilotMessages = threadIds.length
    ? await rows(pool, `SELECT * FROM copilot_messages WHERE thread_id = ANY($1::bigint[]) ORDER BY created_at`, [threadIds])
    : []

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    user,
    stars,
    feedback,
    subscriptions,
    signals,
    issueDrafts,
    collections: collections.map((collection) => ({
      ...collection,
      items: collectionItems.filter((item) => Number(item.collection_id) === Number(collection.id)),
    })),
    notifications,
    projects,
    integrationReports,
    maintainerReports,
    discoverabilityReports,
    comparisonReports,
    watch: { intents: watchIntents, matches: watchMatches, runs: watchRuns },
    integrationOutcomes,
    issuePlans,
    feed: { dismissals: feedDismissals, statuses: feedStatuses, impressions: feedImpressions },
    jobs: jobs.map((job) => ({ ...job, payload: redactJobPayload(job.payload) })),
    copilot: copilotThreads.map((thread) => ({
      ...thread,
      messages: copilotMessages.filter((message) => Number(message.thread_id) === Number(thread.id)),
    })),
    activity: { syncState: activitySyncState, seen: activitySeen },
    llmUsage,
    radarSnapshots,
    deliveries,
    patches,
    pushSubscriptions: {
      count: Number(pushCount.rows[0]?.count ?? 0),
      note: '推送订阅的 endpoint 和密钥属于凭据，不包含在导出中。',
    },
    githubTokenConnected: githubTokens.length > 0,
  }
}

/**
 * 删除用户及其全部派生数据。数据库外键均使用 ON DELETE CASCADE。
 * 删除前先标记运行中的任务取消，避免 worker 继续更新已删除的用户。
 */
export async function deleteUserAccount(pool: DbPool, userId: number): Promise<boolean> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `UPDATE ai_jobs SET cancel_requested = TRUE WHERE user_id = $1 AND status IN ('queued', 'running')`,
      [userId],
    )
    const result = await client.query(`DELETE FROM users WHERE id = $1`, [userId])
    await client.query('COMMIT')
    return (result.rowCount ?? 0) > 0
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}
