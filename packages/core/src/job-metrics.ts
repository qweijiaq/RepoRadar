import type { DbPool } from './db.js'

export interface JobKindMetrics {
  kind: string
  total: number
  succeeded: number
  failed: number
  running: number
  successRate: number | null
  avgSeconds: number | null
  p95Seconds: number | null
  promptTokens: number
  completionTokens: number
  calls: number
}

export interface JobFailureReason {
  kind: string
  error: string
  count: number
  lastAt: string
}

interface MetricsRow {
  kind: string
  total: string
  succeeded: string
  failed: string
  running: string
  avg_seconds: number | null
  p95_seconds: number | null
  prompt_tokens: string
  completion_tokens: string
  calls: string
}

/**
 * 按任务类型聚合近 N 天的成功率、耗时和 token 用量。
 * 只统计有任务记录的 kind；没有调用模型的任务 token 为 0。
 */
export async function loadJobKindMetrics(pool: DbPool, days = 30): Promise<JobKindMetrics[]> {
  const { rows } = await pool.query<MetricsRow>(
    `WITH window_jobs AS (
       SELECT id, kind, status, started_at, finished_at
       FROM ai_jobs
       WHERE created_at >= now() - ($1::int * INTERVAL '1 day')
     ), usage AS (
       SELECT job_id,
              sum(prompt_tokens) AS prompt_tokens,
              sum(completion_tokens) AS completion_tokens,
              count(*) AS calls
       FROM llm_usage
       WHERE job_id IS NOT NULL
       GROUP BY job_id
     )
     SELECT j.kind,
            count(*) AS total,
            count(*) FILTER (WHERE j.status = 'succeeded') AS succeeded,
            count(*) FILTER (WHERE j.status = 'failed') AS failed,
            count(*) FILTER (WHERE j.status = 'running') AS running,
            avg(extract(epoch FROM (j.finished_at - j.started_at)))
              FILTER (WHERE j.finished_at IS NOT NULL AND j.started_at IS NOT NULL) AS avg_seconds,
            percentile_cont(0.95) WITHIN GROUP (
              ORDER BY CASE
                WHEN j.finished_at IS NOT NULL AND j.started_at IS NOT NULL
                THEN extract(epoch FROM (j.finished_at - j.started_at))
              END
            ) AS p95_seconds,
            COALESCE(sum(u.prompt_tokens), 0) AS prompt_tokens,
            COALESCE(sum(u.completion_tokens), 0) AS completion_tokens,
            COALESCE(sum(u.calls), 0) AS calls
     FROM window_jobs j
     LEFT JOIN usage u ON u.job_id = j.id
     GROUP BY j.kind
     ORDER BY total DESC, j.kind`,
    [days],
  )

  return rows.map((row) => {
    const succeeded = Number(row.succeeded)
    const failed = Number(row.failed)
    const finished = succeeded + failed
    return {
      kind: row.kind,
      total: Number(row.total),
      succeeded,
      failed,
      running: Number(row.running),
      successRate: finished > 0 ? succeeded / finished : null,
      avgSeconds: row.avg_seconds === null ? null : Number(row.avg_seconds),
      p95Seconds: row.p95_seconds === null ? null : Number(row.p95_seconds),
      promptTokens: Number(row.prompt_tokens),
      completionTokens: Number(row.completion_tokens),
      calls: Number(row.calls),
    }
  })
}

/** 失败原因聚合，便于发现「同一类错误反复出现」。 */
export async function loadJobFailureReasons(
  pool: DbPool,
  days = 30,
  limit = 8,
): Promise<JobFailureReason[]> {
  const { rows } = await pool.query<{
    kind: string
    error: string
    count: string
    last_at: string
  }>(
    `SELECT kind, COALESCE(error, '未知错误') AS error, count(*) AS count,
            max(created_at) AS last_at
     FROM ai_jobs
     WHERE status = 'failed' AND created_at >= now() - ($1::int * INTERVAL '1 day')
     GROUP BY kind, COALESCE(error, '未知错误')
     ORDER BY count(*) DESC, max(created_at) DESC
     LIMIT $2`,
    [days, limit],
  )
  return rows.map((row) => ({
    kind: row.kind,
    error: row.error.slice(0, 200),
    count: Number(row.count),
    lastAt: row.last_at,
  }))
}
