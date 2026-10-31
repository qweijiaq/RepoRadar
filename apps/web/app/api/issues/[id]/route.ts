import { auth } from '@/auth'
import { getPool } from '@/lib/db'
import { findIssueDraft } from '@/lib/issue-drafts'
import { sessionUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(_request: Request, context: RouteContext) {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) return new Response('Unauthorized', { status: 401 })

  const { id } = await context.params
  const draft = await findIssueDraft(getPool(), Number(currentUser.id), Number(id))
  if (!draft) return new Response('Not found', { status: 404 })

  return new Response(draft.html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-disposition': `attachment; filename="repo-radar-issue-${draft.id}.html"`,
    },
  })
}
