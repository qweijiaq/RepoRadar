import { getPool, loadDailyRanking, resolveBaseUrl } from '@repo-radar/core'

export const dynamic = 'force-dynamic'

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export async function GET(): Promise<Response> {
  const pool = getPool()
  const [ranking, baseUrl] = await Promise.all([loadDailyRanking(pool, 10), resolveBaseUrl(pool)])
  const site = baseUrl.replace(/\/+$/, '')
  const items = ranking.items
    .map((item) => {
      const repoUrl = `${site}/r/${item.fullName}`
      const title = `${item.fullName} +${item.gain.toLocaleString('en-US')} stars`
      const description = item.summary ?? `${item.language ?? '未知语言'} · ${item.stars} stars`
      return `<item>
  <title>${escapeXml(title)}</title>
  <link>${escapeXml(repoUrl)}</link>
  <guid isPermaLink="true">${escapeXml(repoUrl)}</guid>
  <description>${escapeXml(description)}</description>
</item>`
    })
    .join('\n')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>RepoRadar 每日飙升 Top10</title>
  <link>${escapeXml(site)}</link>
  <description>${escapeXml(`${ranking.dateLabel} · 按 star 增量排序`)}</description>
  <language>zh-CN</language>
  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
</channel>
</rss>`

  return new Response(xml, {
    headers: {
      'content-type': 'application/rss+xml; charset=utf-8',
      'cache-control': 'public, max-age=600',
    },
  })
}
