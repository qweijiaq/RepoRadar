import type { DbPool } from './db.js'

const SETTINGS_KEY = 'retention.config'
const LAST_RUN_KEY = 'retention.lastRun'
const LOCK_ID = 728411

export interface RetentionConfig {
  notificationsDays: number
  deliveryQueueDays: number
  aiJobsDays: number
  activitySeenDays: number
  llmUsageDays: number
  ingestRunsDays: number
  verificationsDays: number
  copilotDays: number
  generatedContentDays: number
}

export const DEFAULT_RETENTION_CONFIG: RetentionConfig = {
  notificationsDays: 90,
  deliveryQueueDays: 30,
  aiJobsDays: 60,
  activitySeenDays: 90,
  llmUsageDays: 365,
  ingestRunsDays: 90,
  verificationsDays: 90,
  copilotDays: 0,
  generatedContentDays: 0,
}

export interface RetentionCounts {
  notifications: number
  deliveries: number
  jobs: number
  activity: number
  llmUsage: number
  ingestRuns: number
  verifications: number
  copilotMessages: number
  copilotThreads: number
  issueDrafts: number
  integrationReports: number
  maintainerReports: number
  discoverabilityReports: number
  comparisonReports: number
  issuePlans: number
  patchDrafts: number
  total: number
}

export interface RetentionLastRun {
  at: string
  counts: RetentionCounts
}

interface RetentionDb {
  query: (text: string, values?: unknown[]) => Promise<{ rowCount: number | null; rows: Array<Record<string, unknown>> }>
}

function clampDays(value: unknown, fallback: number): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(0, Math.min(3650, Math.floor(number)))
}

export function normalizeRetentionConfig(input: Partial<RetentionConfig> | null | undefined): RetentionConfig {
  return {
    notificationsDays: clampDays(input?.notificationsDays, DEFAULT_RETENTION_CONFIG.notificationsDays),
    deliveryQueueDays: clampDays(input?.deliveryQueueDays, DEFAULT_RETENTION_CONFIG.deliveryQueueDays),
    aiJobsDays: clampDays(input?.aiJobsDays, DEFAULT_RETENTION_CONFIG.aiJobsDays),
    activitySeenDays: clampDays(input?.activitySeenDays, DEFAULT_RETENTION_CONFIG.activitySeenDays),
    llmUsageDays: clampDays(input?.llmUsageDays, DEFAULT_RETENTION_CONFIG.llmUsageDays),
    ingestRunsDays: clampDays(input?.ingestRunsDays, DEFAULT_RETENTION_CONFIG.ingestRunsDays),
    verificationsDays: clampDays(input?.verificationsDays, DEFAULT_RETENTION_CONFIG.verificationsDays),
    copilotDays: clampDays(input?.copilotDays, DEFAULT_RETENTION_CONFIG.copilotDays),
    generatedContentDays: clampDays(input?.generatedContentDays, DEFAULT_RETENTION_CONFIG.generatedContentDays),
  }
}

export async function loadRetentionConfig(pool: DbPool): Promise<RetentionConfig> {
  try {
    const { rows } = await pool.query<{ value: Partial<RetentionConfig> }>(
      `SELECT value FROM app_settings WHERE key = $1`,
      [SETTINGS_KEY],
    )
    return normalizeRetentionConfig(rows[0]?.value)
  } catch {
    return DEFAULT_RETENTION_CONFIG
  }
}

export async function saveRetentionConfig(
  pool: DbPool,
  input: Partial<RetentionConfig>,
): Promise<RetentionConfig> {
  const config = normalizeRetentionConfig(input)
  await pool.query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [SETTINGS_KEY, JSON.stringify(config)],
  )
  return config
}

export async function clearRetentionConfig(pool: DbPool): Promise<void> {
  await pool.query(`DELETE FROM app_settings WHERE key = $1`, [SETTINGS_KEY])
}

async function deleteOlder(
  db: RetentionDb,
  sql: string,
  days: number,
): Promise<number> {
  if (days <= 0) return 0
  const result = await db.query(sql, [days])
  return result.rowCount ?? 0
}

export async function cleanupExpiredData(db: RetentionDb, config: RetentionConfig): Promise<RetentionCounts> {
  const notifications = await deleteOlder(
    db,
    `DELETE FROM notifications
     WHERE read_at IS NOT NULL AND created_at < now() - make_interval(days => $1)`,
    config.notificationsDays,
  )
  const deliveries = await deleteOlder(
    db,
    `DELETE FROM delivery_queue
     WHERE status IN ('sent', 'failed') AND created_at < now() - make_interval(days => $1)`,
    config.deliveryQueueDays,
  )
  const jobs = await deleteOlder(
    db,
    `DELETE FROM ai_jobs
     WHERE status IN ('succeeded', 'failed', 'cancelled')
       AND COALESCE(finished_at, created_at) < now() - make_interval(days => $1)`,
    config.aiJobsDays,
  )
  const activity = await deleteOlder(
    db,
    `DELETE FROM activity_seen WHERE seen_at < now() - make_interval(days => $1)`,
    config.activitySeenDays,
  )
  const llmUsage = await deleteOlder(
    db,
    `DELETE FROM llm_usage WHERE created_at < now() - make_interval(days => $1)`,
    config.llmUsageDays,
  )
  const ingestRuns = await deleteOlder(
    db,
    `DELETE FROM ingest_runs WHERE finished_at IS NOT NULL AND started_at < now() - make_interval(days => $1)`,
    config.ingestRunsDays,
  )
  const verifications = await deleteOlder(
    db,
    `DELETE FROM verifications WHERE verified_at < now() - make_interval(days => $1)`,
    config.verificationsDays,
  )
  const copilotMessages = await deleteOlder(
    db,
    `DELETE FROM copilot_messages WHERE created_at < now() - make_interval(days => $1)`,
    config.copilotDays,
  )
  const copilotThreads = await deleteOlder(
    db,
    `DELETE FROM copilot_threads t
     WHERE t.updated_at < now() - make_interval(days => $1)
       AND NOT EXISTS (SELECT 1 FROM copilot_messages m WHERE m.thread_id = t.id)`,
    config.copilotDays,
  )
  const issueDrafts = await deleteOlder(
    db,
    `DELETE FROM issue_drafts WHERE created_at < now() - make_interval(days => $1)`,
    config.generatedContentDays,
  )
  const integrationReports = await deleteOlder(
    db,
    `DELETE FROM integration_reports WHERE created_at < now() - make_interval(days => $1)`,
    config.generatedContentDays,
  )
  const maintainerReports = await deleteOlder(
    db,
    `DELETE FROM maintainer_reports WHERE created_at < now() - make_interval(days => $1)`,
    config.generatedContentDays,
  )
  const discoverabilityReports = await deleteOlder(
    db,
    `DELETE FROM discoverability_reports WHERE created_at < now() - make_interval(days => $1)`,
    config.generatedContentDays,
  )
  const comparisonReports = await deleteOlder(
    db,
    `DELETE FROM comparison_reports WHERE created_at < now() - make_interval(days => $1)`,
    config.generatedContentDays,
  )
  const issuePlans = await deleteOlder(
    db,
    `DELETE FROM issue_plans WHERE created_at < now() - make_interval(days => $1)`,
    config.generatedContentDays,
  )
  const patchDrafts = await deleteOlder(
    db,
    `DELETE FROM patch_drafts WHERE created_at < now() - make_interval(days => $1)`,
    config.generatedContentDays,
  )

  const counts: RetentionCounts = {
    notifications,
    deliveries,
    jobs,
    activity,
    llmUsage,
    ingestRuns,
    verifications,
    copilotMessages,
    copilotThreads,
    issueDrafts,
    integrationReports,
    maintainerReports,
    discoverabilityReports,
    comparisonReports,
    issuePlans,
    patchDrafts,
    total: 0,
  }
  counts.total = Object.entries(counts)
    .filter(([key]) => key !== 'total')
    .reduce((sum, [, value]) => sum + Number(value), 0)
  return counts
}

export async function loadRetentionLastRun(pool: DbPool): Promise<RetentionLastRun | null> {
  const { rows } = await pool.query<{ value: RetentionLastRun }>(
    `SELECT value FROM app_settings WHERE key = $1`,
    [LAST_RUN_KEY],
  )
  return rows[0]?.value ?? null
}

/**
 * 每 24 小时最多执行一次，使用事务级 advisory lock 防止多 worker 重复清理。
 */
export async function runRetentionIfDue(
  pool: DbPool,
  options: { force?: boolean } = {},
): Promise<RetentionCounts | null> {
  const config = await loadRetentionConfig(pool)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const lock = await client.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_xact_lock($1) AS locked`,
      [LOCK_ID],
    )
    if (!lock.rows[0]?.locked) {
      await client.query('ROLLBACK')
      return null
    }
    if (!options.force) {
      const last = await client.query<{ value: RetentionLastRun }>(
        `SELECT value FROM app_settings WHERE key = $1`,
        [LAST_RUN_KEY],
      )
      const at = last.rows[0]?.value?.at
      if (at && Date.now() - Date.parse(at) < 24 * 60 * 60 * 1000) {
        await client.query('ROLLBACK')
        return null
      }
    }
    const counts = await cleanupExpiredData(
      { query: (text, values) => client.query(text, values) },
      config,
    )
    await client.query(
      `INSERT INTO app_settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [LAST_RUN_KEY, JSON.stringify({ at: new Date().toISOString(), counts })],
    )
    await client.query('COMMIT')
    return counts
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}
