import { AsyncLocalStorage } from 'node:async_hooks'
import type { DbPool } from './db.js'

export interface LlmUsageEntry {
  providerId: string | null
  model: string
  promptTokens: number
  completionTokens: number
  latencyMs: number
}

export interface LlmUsageSummary {
  calls: number
  promptTokens: number
  completionTokens: number
  models: Array<{ model: string; providerId: string | null; calls: number; tokens: number }>
}

const storage = new AsyncLocalStorage<LlmUsageEntry[]>()

export function recordLlmUsage(entry: LlmUsageEntry): void {
  storage.getStore()?.push(entry)
}

/**
 * 在一次任务/对话内收集底层模型的 usage，并在结束时统一落库。
 */
export async function withLlmUsage<T>(
  fn: () => Promise<T>,
  onDone: (usage: LlmUsageEntry[]) => Promise<void>,
): Promise<T> {
  const usage: LlmUsageEntry[] = []
  return storage.run(usage, async () => {
    try {
      return await fn()
    } finally {
      await onDone(usage).catch((error) => console.error('[usage] 写入失败：', error))
    }
  })
}

export async function recordLlmUsageRows(
  pool: DbPool,
  userId: number,
  jobId: number | null,
  kind: string,
  usage: LlmUsageEntry[],
): Promise<void> {
  for (const entry of usage) {
    await pool.query(
      `INSERT INTO llm_usage (user_id, job_id, kind, provider_id, model, prompt_tokens, completion_tokens, latency_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        userId,
        jobId,
        kind,
        entry.providerId,
        entry.model,
        entry.promptTokens,
        entry.completionTokens,
        entry.latencyMs,
      ],
    )
  }
}

export async function loadUsageSummary(pool: DbPool, userId: number, days = 30): Promise<LlmUsageSummary> {
  const [totals, rowsResult] = await Promise.all([
    pool.query<{ calls: string; prompt: string; completion: string }>(
      `SELECT count(*) AS calls,
         COALESCE(sum(prompt_tokens), 0) AS prompt,
         COALESCE(sum(completion_tokens), 0) AS completion
       FROM llm_usage WHERE user_id = $1 AND created_at >= now() - ($2::int * INTERVAL '1 day')`,
      [userId, days],
    ),
    pool.query<{ model: string; provider_id: string | null; calls: string; tokens: string }>(
      `SELECT model, provider_id, count(*) AS calls,
         COALESCE(sum(prompt_tokens + completion_tokens), 0) AS tokens
       FROM llm_usage
       WHERE user_id = $1 AND created_at >= now() - ($2::int * INTERVAL '1 day')
       GROUP BY model, provider_id
       ORDER BY tokens DESC`,
      [userId, days],
    ),
  ])
  const rows = rowsResult.rows
  const total = totals.rows[0]
  return {
    calls: Number(total?.calls ?? 0),
    promptTokens: Number(total?.prompt ?? 0),
    completionTokens: Number(total?.completion ?? 0),
    models: rows.map((row) => ({
      model: row.model,
      providerId: row.provider_id,
      calls: Number(row.calls),
      tokens: Number(row.tokens),
    })),
  }
}
