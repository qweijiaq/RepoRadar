import type { MetadataRoute } from 'next'
import { resolveBaseUrl } from '@repo-radar/core'
import { getPool } from '@/lib/db'

export const dynamic = 'force-dynamic'

export default async function robots(): Promise<MetadataRoute.Robots> {
  const base = await resolveBaseUrl(getPool())
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // 需要登录或属于用户私有数据的页面不进搜索索引。
        disallow: [
          '/api/',
          '/feed',
          '/settings',
          '/ops',
          '/tasks',
          '/inbox',
          '/library',
          '/history',
          '/workbench/',
          '/repos',
          '/setup',
          '/unsubscribe',
        ],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  }
}
