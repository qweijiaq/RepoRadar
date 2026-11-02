import { NextResponse } from 'next/server'
import { loadNotificationPrefs, saveNotificationPrefs, countPushSubscriptions, deletePushSubscription, getPool } from '@repo-radar/core'
import { auth } from '@/auth'
import { isDemoLogin } from '@/lib/readonly'
import { sessionUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<NextResponse> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (isDemoLogin(currentUser.login)) {
    return NextResponse.json({ error: 'demo-readonly' }, { status: 403 })
  }

  const body = (await request.json().catch(() => null)) as { endpoint?: string } | null
  const endpoint = typeof body?.endpoint === 'string' ? body.endpoint : ''
  if (!endpoint) return NextResponse.json({ error: 'missing-endpoint' }, { status: 400 })

  const pool = getPool()
  const userId = Number(currentUser.id)
  await deletePushSubscription(pool, userId, endpoint)
  const devices = await countPushSubscriptions(pool, userId)
  if (devices === 0) {
    const prefs = await loadNotificationPrefs(pool, userId)
    if (prefs.pushNotifications) {
      await saveNotificationPrefs(pool, userId, { ...prefs, pushNotifications: false })
    }
  }
  return NextResponse.json({ ok: true, devices })
}
