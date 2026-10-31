import type { DbPool } from './db.js'
import type { JobKind } from './jobs.js'

const SETTINGS_KEY = 'limits.config'

export interface QuotaConfig {
  aiEnabled: boolean
  dailyAiCalls: number
  dailyAiTokens: number
  hourlyJobs: number
  dailyJobs: number
  maxQueuedJobs: number
  copilotMessagesPerHour: number
  dailyDeliveries: number
  globalDailyTokens: number
}

export const DEFAULT_QUOTA_CONFIG: QuotaConfig = {
  aiEnabled: true,
  dailyAiCalls: 200,
  dailyAiTokens: 5_000_000,
  hourlyJobs: 20,
  dailyJobs: 100,
  maxQueuedJobs: 10,
  copilotMessagesPerHour: 60,
  dailyDeliveries: 200,
  globalDailyTokens: 50_000_000,
}

export type QuotaCode =
  | 'ai-disabled'
  | 'daily-ai-calls'
  | 'daily-ai-tokens'
  | 'global-ai-tokens'
  | 'hourly-jobs'
  | 'daily-jobs'
  | 'queued-jobs'
  | 'copilot-hourly'

export class QuotaError extends Error {
  readonly code: QuotaCode

  constructor(code: QuotaCode, message: string) {
    super(message)
    this.name = 'QuotaError'
    this.code = code
  }
}

export function isQuotaError(error: unknown): error is QuotaError {
  return error instanceof QuotaError
}

function nonNegativeInt(value: unknown, fallback: number): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(0, Math.min(1_000_000_000, Math.floor(number)))
}

export function normalizeQuotaConfig(input: Partial<QuotaConfig> | null | undefined): QuotaConfig {
  return {
    aiEnabled: input?.aiEnabled !== false,
    dailyAiCalls: nonNegativeInt(input?.dailyAiCalls, DEFAULT_QUOTA_CONFIG.dailyAiCalls),
    dailyAiTokens: nonNegativeInt(input?.dailyAiTokens, DEFAULT_QUOTA_CONFIG.dailyAiTokens),
    hourlyJobs: nonNegativeInt(input?.hourlyJobs, DEFAULT_QUOTA_CONFIG.hourlyJobs),
    dailyJobs: nonNegativeInt(input?.dailyJobs, DEFAULT_QUOTA_CONFIG.dailyJobs),
    maxQueuedJobs: nonNegativeInt(input?.maxQueuedJobs, DEFAULT_QUOTA_CONFIG.maxQueuedJobs),
    copilotMessagesPerHour: nonNegativeInt(
      input?.copilotMessagesPerHour,
      DEFAULT_QUOTA_CONFIG.copilotMessagesPerHour,
    ),
    dailyDeliveries: nonNegativeInt(input?.dailyDeliveries, DEFAULT_QUOTA_CONFIG.dailyDeliveries),
    globalDailyTokens: nonNegativeInt(input?.globalDailyTokens, DEFAULT_QUOTA_CONFIG.globalDailyTokens),
  }
}

export async function loadQuotaConfig(pool: DbPool): Promise<QuotaConfig> {
  try {
    const { rows } = await pool.query<{ value: Partial<QuotaConfig> }>(
      `SELECT value FROM app_settings WHERE key = $1`,
      [SETTINGS_KEY],
    )
    return normalizeQuotaConfig(rows[0]?.value)
  } catch {
    return DEFAULT_QUOTA_CONFIG
  }
}

export async function saveQuotaConfig(pool: DbPool, input: Partial<QuotaConfig>): Promise<QuotaConfig> {
  const config = normalizeQuotaConfig(input)
  await pool.query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [SETTINGS_KEY, JSON.stringify(config)],
  )
  return config
}

export async function clearQuotaConfig(pool: DbPool): Promise<void> {
  await pool.query(`DELETE FROM app_settings WHERE key = $1`, [SETTINGS_KEY])
}

const AI_JOB_KINDS = new Set<JobKind>([
  'integration',
  'maintainer',
  'issue',
  'discoverability',
  'comparison',
  'issue-plan',
  'watch',
  'patch',
  'upgrade',
])

export function jobUsesAi(kind: JobKind): boolean {
  return AI_JOB_KINDS.has(kind)
}

export interface AiQuotaUsage {
  calls: number
  tokens: number
  globalTokens: number
}

export async function loadAiUsageToday(pool: DbPool, userId: number): Promise<AiQuotaUsage> {
  const [user, global] = await Promise.all([
    pool.query<{ calls: string; tokens: string }>(
      `SELECT count(*) AS calls,
         COALESCE(sum(prompt_tokens + completion_tokens), 0) AS tokens
       FROM llm_usage
       WHERE user_id = $1 AND created_at >= date_trunc('day', now())`,
      [userId],
    ),
    pool.query<{ tokens: string }>(
      `SELECT COALESCE(sum(prompt_tokens + completion_tokens), 0) AS tokens
       FROM llm_usage WHERE created_at >= date_trunc('day', now())`,
    ),
  ])
  return {
    calls: Number(user.rows[0]?.calls ?? 0),
    tokens: Number(user.rows[0]?.tokens ?? 0),
    globalTokens: Number(global.rows[0]?.tokens ?? 0),
  }
}

export async function assertAiQuota(pool: DbPool, userId: number): Promise<QuotaConfig> {
  const config = await loadQuotaConfig(pool)
  if (!config.aiEnabled) {
    throw new QuotaError('ai-disabled', 'AI 功能当前已暂停，请稍后再试。')
  }
  const usage = await loadAiUsageToday(pool, userId)
  if (config.dailyAiCalls > 0 && usage.calls >= config.dailyAiCalls) {
    throw new QuotaError('daily-ai-calls', `今日 AI 调用次数已达上限（${config.dailyAiCalls} 次）。`)
  }
  if (config.dailyAiTokens > 0 && usage.tokens >= config.dailyAiTokens) {
    throw new QuotaError('daily-ai-tokens', `今日 AI token 用量已达上限（${config.dailyAiTokens}）。`)
  }
  if (config.globalDailyTokens > 0 && usage.globalTokens >= config.globalDailyTokens) {
    throw new QuotaError('global-ai-tokens', '全站今日 AI 用量已达上限，请稍后再试。')
  }
  return config
}

export async function assertJobQuota(pool: DbPool, userId: number, kind: JobKind): Promise<QuotaConfig> {
  const config = await loadQuotaConfig(pool)
  if (jobUsesAi(kind) && !config.aiEnabled) {
    throw new QuotaError('ai-disabled', 'AI 功能当前已暂停，请稍后再试。')
  }
  const [hourly, daily, active] = await Promise.all([
    pool.query<{ count: string }>(
      `SELECT count(*) FROM ai_jobs WHERE user_id = $1 AND kind <> 'activity' AND created_at >= now() - INTERVAL '1 hour'`,
      [userId],
    ),
    pool.query<{ count: string }>(
      `SELECT count(*) FROM ai_jobs WHERE user_id = $1 AND kind <> 'activity' AND created_at >= date_trunc('day', now())`,
      [userId],
    ),
    pool.query<{ count: string }>(
      `SELECT count(*) FROM ai_jobs WHERE user_id = $1 AND status IN ('queued', 'running')`,
      [userId],
    ),
  ])
  const hourlyCount = Number(hourly.rows[0]?.count ?? 0)
  const dailyCount = Number(daily.rows[0]?.count ?? 0)
  const activeCount = Number(active.rows[0]?.count ?? 0)
  if (config.hourlyJobs > 0 && hourlyCount >= config.hourlyJobs) {
    throw new QuotaError('hourly-jobs', `每小时最多创建 ${config.hourlyJobs} 个任务，请稍后再试。`)
  }
  if (config.dailyJobs > 0 && dailyCount >= config.dailyJobs) {
    throw new QuotaError('daily-jobs', `今日任务数已达上限（${config.dailyJobs} 个）。`)
  }
  if (config.maxQueuedJobs > 0 && activeCount >= config.maxQueuedJobs) {
    throw new QuotaError('queued-jobs', `当前已有 ${activeCount} 个任务在排队或运行，请等它们完成。`)
  }
  return config
}

export async function assertCopilotQuota(pool: DbPool, userId: number): Promise<void> {
  const config = await assertAiQuota(pool, userId)
  if (config.copilotMessagesPerHour <= 0) return
  const { rows } = await pool.query<{ count: string }>(
    `SELECT count(*) FROM copilot_messages m
     JOIN copilot_threads t ON t.id = m.thread_id
     WHERE t.user_id = $1 AND m.role = 'user' AND m.created_at >= now() - INTERVAL '1 hour'`,
    [userId],
  )
  if (Number(rows[0]?.count ?? 0) >= config.copilotMessagesPerHour) {
    throw new QuotaError('copilot-hourly', `每小时最多发送 ${config.copilotMessagesPerHour} 条 Copilot 消息。`)
  }
}

export async function deliveryAllowed(pool: DbPool, userId: number): Promise<boolean> {
  const config = await loadQuotaConfig(pool)
  if (config.dailyDeliveries <= 0) return true
  const { rows } = await pool.query<{ count: string }>(
    `SELECT count(*) FROM delivery_queue
     WHERE user_id = $1 AND created_at >= date_trunc('day', now())`,
    [userId],
  )
  return Number(rows[0]?.count ?? 0) < config.dailyDeliveries
}

export interface QuotaUsageSnapshot {
  aiCalls: number
  aiTokens: number
  globalTokens: number
  jobsToday: number
  jobsThisHour: number
  activeJobs: number
  deliveriesToday: number
  copilotThisHour: number
}

export async function loadQuotaUsage(pool: DbPool, userId: number): Promise<QuotaUsageSnapshot> {
  const [ai, jobs, deliveries, copilot] = await Promise.all([
    loadAiUsageToday(pool, userId),
    pool.query<{ today: string; hour: string; active: string }>(
      `SELECT
         count(*) FILTER (WHERE kind <> 'activity' AND created_at >= date_trunc('day', now())) AS today,
         count(*) FILTER (WHERE kind <> 'activity' AND created_at >= now() - INTERVAL '1 hour') AS hour,
         count(*) FILTER (WHERE status IN ('queued', 'running')) AS active
       FROM ai_jobs WHERE user_id = $1`,
      [userId],
    ),
    pool.query<{ count: string }>(
      `SELECT count(*) FROM delivery_queue
       WHERE user_id = $1 AND created_at >= date_trunc('day', now())`,
      [userId],
    ),
    pool.query<{ count: string }>(
      `SELECT count(*) FROM copilot_messages m
       JOIN copilot_threads t ON t.id = m.thread_id
       WHERE t.user_id = $1 AND m.role = 'user' AND m.created_at >= now() - INTERVAL '1 hour'`,
      [userId],
    ),
  ])
  return {
    aiCalls: ai.calls,
    aiTokens: ai.tokens,
    globalTokens: ai.globalTokens,
    jobsToday: Number(jobs.rows[0]?.today ?? 0),
    jobsThisHour: Number(jobs.rows[0]?.hour ?? 0),
    activeJobs: Number(jobs.rows[0]?.active ?? 0),
    deliveriesToday: Number(deliveries.rows[0]?.count ?? 0),
    copilotThisHour: Number(copilot.rows[0]?.count ?? 0),
  }
}
