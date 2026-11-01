import { getPool, getVapidPublicKey } from '@repo-radar/core'
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { sessionUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  const session = await auth()
  if (!sessionUser(session)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const publicKey = await getVapidPublicKey(getPool())
  return NextResponse.json({ publicKey }, { headers: { 'cache-control': 'no-store' } })
}
