import { NextResponse } from 'next/server'
import {
  countPushSubscriptions,
  isValidPushSubscription,
  savePushSubscription,
} from '@/lib/push'
import { saveNotificationPrefs, loadNotificationPrefs } from '@repo-radar/core'
import { auth } from '@/auth'
import { getPool } from '@/lib/db'
import { sessionUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<NextResponse> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as
    | { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
    | null
  const input = {
    endpoint: body?.endpoint,
    p256dh: body?.keys?.p256dh,
    auth: body?.keys?.auth,
    userAgent: request.headers.get('user-agent'),
  }
  if (!isValidPushSubscription(input)) {
    return NextResponse.json({ error: 'invalid-subscription' }, { status: 400 })
  }

  const pool = getPool()
  const userId = Number(currentUser.id)
  await savePushSubscription(pool, userId, input)
  const prefs = await loadNotificationPrefs(pool, userId)
  if (!prefs.pushNotifications) {
    await saveNotificationPrefs(pool, userId, { ...prefs, pushNotifications: true })
  }
  const devices = await countPushSubscriptions(pool, userId)
  return NextResponse.json({ ok: true, devices })
}
