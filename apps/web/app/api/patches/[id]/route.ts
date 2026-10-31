import { NextResponse } from 'next/server'
import { findPatchDraft } from '@repo-radar/core'
import { auth } from '@/auth'
import { getPool } from '@/lib/db'
import { sessionUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id: rawId } = await context.params
  const id = Number(rawId)
  if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ error: 'not-found' }, { status: 404 })
  const patch = await findPatchDraft(getPool(), Number(currentUser.id), id)
  if (!patch) return NextResponse.json({ error: 'not-found' }, { status: 404 })
  return new NextResponse(patch.patch, {
    headers: {
      'content-type': 'text/x-diff; charset=utf-8',
      'content-disposition': `attachment; filename="repo-radar-${patch.id}.patch"`,
      'cache-control': 'no-store',
    },
  })
}
