import { searchEnrichedRepos } from '@repo-radar/core'
import { auth } from '@/auth'
import { getPool } from '@/lib/db'
import { rateLimit } from '@/lib/rate-limit'
import { sessionUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) return Response.json({ results: [] }, { status: 401 })
  const limit = rateLimit(`search:${currentUser.id}`, 120, 60_000)
  if (!limit.allowed) {
    return Response.json({ results: [], error: '搜索过于频繁，请稍后再试。' }, { status: 429 })
  }

  const { searchParams } = new URL(request.url)
  const query = (searchParams.get('q') ?? '').trim()
  if (!query) return Response.json({ results: [] })

  const repos = await searchEnrichedRepos(getPool(), { query, limit: 8 })
  return Response.json({
    results: repos.map((repo) => ({
      fullName: repo.fullName,
      url: `/r/${repo.owner}/${repo.name}`,
      summary: repo.summary ?? repo.description ?? '',
      language: repo.language,
      stars: repo.stars,
    })),
  })
}
