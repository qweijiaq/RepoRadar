import { NextResponse } from 'next/server'
import { exportHistoryContent, listHistory } from '@repo-radar/core'
import { auth } from '@/auth'
import { getPool } from '@/lib/db'
import { sessionUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<NextResponse> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const full = new URL(request.url).searchParams.get('full') === '1'
  const entries = await listHistory(getPool(), Number(currentUser.id), 200)
  const content = full
    ? await exportHistoryContent(getPool(), Number(currentUser.id), 200)
    : undefined
  const body = JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      login: currentUser.login,
      entries,
      ...(content ? { content } : {}),
    },
    null,
    2,
  )
  return new NextResponse(body, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="repo-radar-history${full ? '-full' : ''}.json"`,
    },
  })
}
