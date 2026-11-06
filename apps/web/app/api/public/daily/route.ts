import { getPool, loadDailyRanking, resolveBaseUrl } from '@repo-radar/core'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  const pool = getPool()
  const [ranking, baseUrl] = await Promise.all([loadDailyRanking(pool, 10), resolveBaseUrl(pool)])
  const site = baseUrl.replace(/\/+$/, '')
  return new Response(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        dateKey: ranking.dateKey,
        dateLabel: ranking.dateLabel,
        basis: ranking.basis,
        previousDate: ranking.previousDate,
        items: ranking.items.map((item) => ({
          fullName: item.fullName,
          stars: item.stars,
          gain: item.gain,
          growth: item.growth,
          language: item.language,
          summary: item.summary,
          topics: item.topics,
          url: `${site}/r/${item.fullName}`,
        })),
      },
      null,
      2,
    ),
    {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=600',
        'access-control-allow-origin': '*',
      },
    },
  )
}
