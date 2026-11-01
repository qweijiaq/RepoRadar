import type { Instrumentation } from 'next'
import { reportError } from '@repo-radar/core/error-report'

export function register(): void {
  // 服务器启动时打一条结构化日志，便于确认版本和可选的上报通道是否配置。
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: 'info',
      event: 'app.boot',
      node: process.version,
      errorWebhook: Boolean(process.env.ERROR_WEBHOOK_URL?.trim()),
    }),
  )
}

/**
 * Next 会把服务端未捕获的渲染/路由错误交到这里。
 * 统一走 core 的 reportError：stdout 结构化日志 + 可选的 ERROR_WEBHOOK_URL。
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const digest =
    error && typeof error === 'object' && 'digest' in error
      ? String((error as { digest?: unknown }).digest ?? '')
      : null
  await reportError({
    source: 'request',
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : null,
    path: request.path,
    digest,
    extra: {
      method: request.method,
      routePath: context.routePath,
      routeType: context.routeType,
      routerKind: context.routerKind,
    },
  })
}
