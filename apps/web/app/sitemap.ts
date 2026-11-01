import type { MetadataRoute } from 'next'
import { resolveBaseUrl } from '@repo-radar/core'
import { getPool } from '@/lib/db'

export const dynamic = 'force-dynamic'

/** 公开可索引的页面：首页、法务页，以及收录项目的公开情报页。 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pool = getPool()
  const base = await resolveBaseUrl(pool)
  const entries: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: 'daily', priority: 1 },
    { url: `${base}/privacy`, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${base}/terms`, changeFrequency: 'yearly', priority: 0.2 },
  ]

  try {
    const { rows } = await pool.query<{
      owner: string
      name: string
      updated_at: Date | string
    }>(
      `SELECT owner, name, updated_at
       FROM repos
       WHERE enriched_at IS NOT NULL
       ORDER BY quality_score DESC NULLS LAST
       LIMIT 500`,
    )
    for (const row of rows) {
      entries.push({
        url: `${base}/r/${row.owner}/${row.name}`,
        lastModified: row.updated_at,
        changeFrequency: 'daily',
        priority: 0.6,
      })
    }
  } catch {
    // 数据库不可用时至少返回固定页面，不要让 sitemap 整体失败。
  }

  return entries
}
