import { getPool } from '@repo-radar/core'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  try {
    await getPool().query('SELECT 1')
    return NextResponse.json({ ok: true, database: 'ok' }, { headers: { 'cache-control': 'no-store' } })
  } catch {
    return NextResponse.json(
      { ok: false, database: 'error' },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    )
  }
}
