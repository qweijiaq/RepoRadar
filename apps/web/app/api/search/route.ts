import { searchEnrichedRepos } from '@repo-radar/core'
import { auth } from '@/auth'
import { getPool } from '@/lib/db'
import { sessionUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const session = await auth()
  if (!sessionUser(session)) return Response.json({ results: [] }, { status: 401 })

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
