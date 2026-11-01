import { NextResponse } from 'next/server'
import { reportError } from '@repo-radar/core/error-report'
import { auth } from '@/auth'
import { rateLimit } from '@/lib/rate-limit'
import { sessionUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

interface ClientErrorBody {
  message?: unknown
  stack?: unknown
  path?: unknown
  digest?: unknown
}

/**
 * 浏览器错误边界上报入口。只做结构化日志/转发，不返回原始信息。
 */
export async function POST(request: Request): Promise<NextResponse> {
  const session = await auth()
  const user = sessionUser(session)
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
  const key = `client-error:${user?.id ?? forwarded}`
  if (!rateLimit(key, 10, 60_000).allowed) {
    return new NextResponse(null, { status: 429 })
  }

  const raw = await request.text()
  if (raw.length > 8_000) return NextResponse.json({ ok: false }, { status: 413 })

  let body: ClientErrorBody
  try {
    body = JSON.parse(raw) as ClientErrorBody
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!message) return NextResponse.json({ ok: false }, { status: 400 })

  await reportError({
    source: 'client',
    message,
    stack: typeof body.stack === 'string' ? body.stack : null,
    path: typeof body.path === 'string' ? body.path : null,
    digest: typeof body.digest === 'string' ? body.digest : null,
    userId: user ? Number(user.id) : null,
  })

  return NextResponse.json({ ok: true })
}
