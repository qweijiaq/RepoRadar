import { countUnreadNotifications } from '@repo-radar/core'
import { getPool } from '@/lib/db'

/**
 * 未读数单独渲染，避免布局在返回 HTML 前多做一次数据库往返。
 */
export async function UnreadBadge({ userId }: { userId: number }) {
  const unread = await countUnreadNotifications(getPool(), userId)
  if (unread <= 0) return null
  return <span className="nav-badge">{unread}</span>
}
