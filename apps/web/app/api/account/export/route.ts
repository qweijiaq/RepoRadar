import { NextResponse } from 'next/server'
import { exportUserData, getPool } from '@repo-radar/core'
import { auth } from '@/auth'
import { rateLimit } from '@/lib/rate-limit'
import { sessionUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const limit = rateLimit(`account-export:${currentUser.id}`, 5, 60 * 60 * 1000)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `导出过于频繁，请 ${Math.ceil(limit.retryAfter / 60)} 分钟后再试。` },
      { status: 429, headers: { 'retry-after': String(limit.retryAfter) } },
    )
  }

  const data = await exportUserData(getPool(), Number(currentUser.id))
  if (!data) return NextResponse.json({ error: 'not-found' }, { status: 404 })

  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="repo-radar-account-${currentUser.login}.json"`,
      'cache-control': 'no-store',
    },
  })
}
