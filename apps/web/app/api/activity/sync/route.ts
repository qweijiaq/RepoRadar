import { getPool } from '@repo-radar/core'
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { maybeQueueActivitySync } from '@/lib/activity-sync'
import { resolveRepoAccess, sessionUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

export async function POST(): Promise<NextResponse> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const access = await resolveRepoAccess(session, currentUser.login, { requireRepoScope: false })
  if (!access.access) return NextResponse.json({ queued: false, reason: 'no-token' })

  const queued = await maybeQueueActivitySync(getPool(), Number(currentUser.id), access.access.token, {
    minIntervalMs: 15 * 60 * 1000,
  })
  return NextResponse.json({ queued })
}
