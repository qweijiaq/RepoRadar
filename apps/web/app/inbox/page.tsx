import Link from 'next/link'
import { redirect } from 'next/navigation'
import { listNotifications, loadNotificationCounts } from '@repo-radar/core'
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
  searchParams: Promise<{ error?: string; category?: string; unread?: string; page?: string }>
}

const PAGE_SIZE = 30
const AI_KINDS = ['integration', 'maintainer', 'watch', 'comparison', 'discoverability', 'issue-plan']

const CATEGORIES = [
  { value: 'all', label: '全部' },
  { value: 'github', label: 'GitHub' },
  { value: 'ai', label: 'AI 工作' },
  { value: 'release', label: '版本' },
  { value: 'system', label: '系统' },
] as const

function inboxHref(category: string, unreadOnly: boolean, page = 1): string {
  const params = new URLSearchParams()
  if (category !== 'all') params.set('category', category)
  if (unreadOnly) params.set('unread', '1')
  if (page > 1) params.set('page', String(page))
  const query = params.toString()
  return query ? `/inbox?${query}` : '/inbox'
}

function categoryFilter(category: string): {
  kinds?: string[]
  prefixes?: string[]
  excludeKinds?: string[]
  excludePrefixes?: string[]
} {
  if (category === 'github') return { prefixes: ['github-'] }
  if (category === 'ai') return { kinds: AI_KINDS }
  if (category === 'release') return { kinds: ['release'] }
  if (category === 'system') {
    return { excludePrefixes: ['github-'], excludeKinds: [...AI_KINDS, 'release'] }
  }
  return {}
}

export default async function InboxPage({ searchParams }: InboxPageProps) {
  const params = await searchParams
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')

  const category = CATEGORIES.some((item) => item.value === params.category) ? params.category! : 'all'
  const unreadOnly = params.unread === '1'
  const requestedPage = Number.parseInt(params.page ?? '', 10)
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1
  const [notificationsPage, counts] = await Promise.all([
    listNotifications(getPool(), Number(currentUser.id), PAGE_SIZE + 1, {
      offset: (page - 1) * PAGE_SIZE,
      unreadOnly,
      ...categoryFilter(category),
    }),
    loadNotificationCounts(getPool(), Number(currentUser.id), AI_KINDS),
  ])
  const hasMore = notificationsPage.length > PAGE_SIZE
  const notifications = notificationsPage.slice(0, PAGE_SIZE)
  const unread = counts.unread
  const categoryCounts: Record<string, number> = {
    github: counts.github,
    ai: counts.ai,
    release: counts.release,
    system: counts.system,
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
            {counts.total === 0 ? '还没有动态' : `第 ${page} 页 · ${notifications.length} 条 · ${unread} 条未读`}
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
              <input type="hidden" name="returnTo" value={inboxHref(category, unreadOnly, page)} />
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
            href={inboxHref(item.value, unreadOnly, 1)}
          >
            {item.label}
            {item.value !== 'all' ? ` ${categoryCounts[item.value] ?? 0}` : ` ${counts.total}`}
          </Link>
        ))}
        <Link
          className={unreadOnly ? 'chip toggle active' : 'chip toggle'}
          href={inboxHref(category, !unreadOnly, 1)}
        >
          只看未读
        </Link>
      </div>

      {notifications.length === 0 ? (
        <div className="empty">
          <p>{counts.total === 0 ? '还没有动态。' : '这个筛选下还没有动态。'}</p>
          <p className="small">
            订阅仓库的 release、生成周报之后，这里会收到通知。也可以点「同步 GitHub 动态」检查自己仓库的新 star、fork、Issue 和 PR。
          </p>
        </div>
      ) : (
        <ul className="notification-list">
          {notifications.map((item) => (
            <li key={item.id} id={`notification-${item.id}`} className={item.readAt ? '' : 'unread'}>
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

      {page > 1 || hasMore ? (
        <div className="history-pagination">
          {page > 1 ? (
            <Link className="btn small" href={inboxHref(category, unreadOnly, page - 1)} scroll={false}>
              上一页
            </Link>
          ) : null}
          <span className="muted small">第 {page} 页</span>
          {hasMore ? (
            <Link className="btn small" href={inboxHref(category, unreadOnly, page + 1)} scroll={false}>
              下一页
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
