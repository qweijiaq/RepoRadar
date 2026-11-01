import { logEvent } from './logger.js'

export interface ErrorReport {
  source: 'server' | 'client' | 'request'
  message: string
  stack?: string | null
  path?: string | null
  digest?: string | null
  userId?: number | null
  extra?: Record<string, unknown>
}

function truncate(value: string | null | undefined, max: number): string | null {
  if (!value) return null
  return value.length > max ? `${value.slice(0, max)}…` : value
}

/**
 * 统一错误上报：结构化日志 + 可选的 webhook。
 * 配了 ERROR_WEBHOOK_URL 才能把错误发到外部（Slack、自建收集器、Sentry 代理等），
 * 没配时只写 stdout，不引入额外依赖。
 */
export async function reportError(report: ErrorReport): Promise<void> {
  const payload = {
    app: 'repo-radar',
    source: report.source,
    message: truncate(report.message, 1000) ?? 'unknown error',
    stack: truncate(report.stack, 4000),
    path: truncate(report.path, 500),
    digest: truncate(report.digest, 200),
    userId: report.userId ?? null,
    ...(report.extra ?? {}),
  }

  logEvent('error', `error.${report.source}`, payload)

  const webhook = process.env.ERROR_WEBHOOK_URL?.trim()
  if (!webhook) return
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...payload, ts: new Date().toISOString() }),
      signal: AbortSignal.timeout(5000),
    })
  } catch (error) {
    logEvent('warn', 'error.webhook_failed', {
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
