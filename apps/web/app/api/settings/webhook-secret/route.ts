import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { isAdminUser } from '@/lib/admin'
import { resolveGithubWebhookSecret } from '@/lib/webhook-config'
import { sessionUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

export async function POST(): Promise<NextResponse> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!(await isAdminUser(currentUser))) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const resolved = await resolveGithubWebhookSecret()
  if (!resolved) return NextResponse.json({ error: 'not-configured' }, { status: 404 })

  return NextResponse.json(
    { secret: resolved.secret, source: resolved.source },
    { headers: { 'cache-control': 'no-store' } },
  )
}
