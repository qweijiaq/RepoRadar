import { redirect } from 'next/navigation'

type LegacySearchParams = Promise<Record<string, string | string[] | undefined>>

/** 把旧路由的查询参数原样带到新路由，避免通知、邮件和书签失效。 */
export async function redirectLegacy(searchParams: LegacySearchParams, target: string): Promise<never> {
  const params = await searchParams
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) for (const item of value) query.append(key, item)
    else if (value !== undefined) query.set(key, value)
  }
  const search = query.toString()
  const separator = target.includes('?') ? '&' : '?'
  redirect(search ? `${target}${separator}${search}` : target)
}
