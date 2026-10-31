import Link from 'next/link'
import { redirect } from 'next/navigation'
import { listNotifications } from '@repo-radar/core'
import { markInboxReadAction, markNotificationReadAction } from '@/app/actions'
import { enqueueActivitySyncAction } from '@/app/jobs/enqueue'
import { auth } from '@/auth'
import { getPool } from '@/lib/db'
import { maybeQueueActivitySync } from '@/lib/activity-sync'
import { resolveRepoAccess, sessionUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

const KIND_LABELS: Record<string, string> = {
  release: '版本更新',
  issue: '周报',
  integration: '接入建议',
  maintainer: '维护周报',
  watch: '关注命中',
  comparison: '选型对比',
  discoverability: '曝光优化',
  'issue-plan': '修复方案',
  job: '任务',
  'github-star': 'Star',
  'github-fork': 'Fork',
  'github-issue': 'Issue',
  'github-pr': 'PR',
  'github-release': 'Release',
}

interface InboxPageProps {
  searchParams: Promise<{ error?: string; category?: string; unread?: string }>
}

const CATEGORIES = [
  { value: 'all', label: '全部' },
  { value: 'github', label: 'GitHub' },
  { value: 'ai', label: 'AI 工作' },
  { value: 'release', label: '版本' },
  { value: 'system', label: '系统' },
] as const

function categoryOf(kind: string): string {
  if (kind.startsWith('github-')) return 'github'
  if (['integration', 'maintainer', 'watch', 'comparison', 'discoverability', 'issue-plan'].includes(kind)) return 'ai'
  if (kind === 'release') return 'release'
  return 'system'
}

function inboxHref(category: string, unreadOnly: boolean): string {
  const params = new URLSearchParams()
  if (category !== 'all') params.set('category', category)
  if (unreadOnly) params.set('unread', '1')
  const query = params.toString()
  return query ? `/inbox?${query}` : '/inbox'
}

export default async function InboxPage({ searchParams }: InboxPageProps) {
  const params = await searchParams
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')

  const allNotifications = await listNotifications(getPool(), Number(currentUser.id), 100)
  const category = CATEGORIES.some((item) => item.value === params.category) ? params.category! : 'all'
  const unreadOnly = params.unread === '1'
  const notifications = allNotifications.filter(
    (item) => (category === 'all' || categoryOf(item.kind) === category) && (!unreadOnly || !item.readAt),
  )
  const unread = allNotifications.filter((item) => !item.readAt).length
  const categoryCounts = new Map<string, number>()
  for (const item of allNotifications) {
    const key = categoryOf(item.kind)
    categoryCounts.set(key, (categoryCounts.get(key) ?? 0) + 1)
  }
  const access = await resolveRepoAccess(session, currentUser.login, { requireRepoScope: false })
  const autoQueued = access.access
    ? await maybeQueueActivitySync(getPool(), Number(currentUser.id), access.access.token)
    : false

  return (
    <div className="page narrow">
      <section className="feed-head">
        <div>
          <p className="eyebrow">动态</p>
          <h1>收件箱</h1>
          <p className="feed-meta">
            {allNotifications.length === 0 ? '还没有动态' : `${notifications.length} 条动态 · ${unread} 条未读`}
          </p>
        </div>
        <div className="feed-actions">
          <form action={enqueueActivitySyncAction}>
            <button className="btn small" type="submit">
              同步 GitHub 动态
            </button>
          </form>
          {unread > 0 ? (
            <form action={markInboxReadAction}>
              <input type="hidden" name="returnTo" value={inboxHref(category, unreadOnly)} />
              <button className="btn small" type="submit">
                全部标记已读
              </button>
            </form>
          ) : null}
        </div>
      </section>

      {params.error === 'need-token' ? (
        <div className="notice">同步 GitHub 动态需要 GitHub 授权，请重新登录后再试。</div>
      ) : null}
      {autoQueued ? (
        <div className="notice">正在后台同步 GitHub 动态，完成后刷新收件箱即可看到新通知。</div>
      ) : null}
      <p className="muted small">
        同步会检查维护中仓库的新 star、fork、打开的 Issue / PR 和 release。第一次同步只建立基线，不会补发历史动态。
      </p>

      <div className="filter-bar notification-filter">
        {CATEGORIES.map((item) => (
          <Link
            key={item.value}
            className={category === item.value ? 'chip toggle active' : 'chip toggle'}
            href={inboxHref(item.value, unreadOnly)}
          >
            {item.label}
            {item.value !== 'all' ? ` ${categoryCounts.get(item.value) ?? 0}` : ` ${allNotifications.length}`}
          </Link>
        ))}
        <Link
          className={unreadOnly ? 'chip toggle active' : 'chip toggle'}
          href={inboxHref(category, !unreadOnly)}
        >
          只看未读
        </Link>
      </div>

      {notifications.length === 0 ? (
        <div className="empty">
          <p>{allNotifications.length === 0 ? '还没有动态。' : '这个分类下还没有动态。'}</p>
          <p className="small">
            订阅仓库的 release、生成周报之后，这里会收到通知。也可以点「同步 GitHub 动态」检查自己仓库的新 star、fork、Issue 和 PR。
          </p>
        </div>
      ) : (
        <ul className="notification-list">
          {notifications.map((item) => (
            <li key={item.id} className={item.readAt ? '' : 'unread'}>
              <div className="notification-head">
                <span className="chip subtle">{KIND_LABELS[item.kind] ?? item.kind}</span>
                <span className="notification-time">{new Date(item.createdAt).toLocaleString('zh-CN')}</span>
              </div>
              <p className="notification-title">
                {item.url ? <Link href={item.url}>{item.title}</Link> : item.title}
              </p>
              {item.body ? <p className="muted small">{item.body}</p> : null}
              {!item.readAt ? (
                <div className="notification-actions">
                  <form action={markNotificationReadAction}>
                    <input type="hidden" name="id" value={item.id} />
                    <input type="hidden" name="returnTo" value={inboxHref(category, unreadOnly)} />
                    <button className="btn quiet small" type="submit">
                      标记已读
                    </button>
                  </form>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
