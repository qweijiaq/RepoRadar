import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  loadComparisonLibrary,
  loadDiscoverabilityLibrary,
  loadIntegrationLibrary,
  loadMaintainerLibrary,
  loadWatchLibrary,
  type LibraryStatus,
} from '@repo-radar/core'
import { auth } from '@/auth'
import { getPool } from '@/lib/db'
import { sessionUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

type LibraryTab = 'integration' | 'watch' | 'maintainer' | 'comparison' | 'discoverability'

interface LibraryPageProps {
  searchParams: Promise<{ tab?: string; status?: string; q?: string; sort?: string }>
}

interface LibraryRowOccurrence {
  title: string
  detail: string
  at: string
  status: LibraryStatus
  href: string
}

interface LibraryRow {
  repo: string
  targetHref: string
  statusLabels?: Partial<Record<LibraryStatus, string>>
  total: number
  groups: string[]
  meta: string
  adopted: number
  rejected: number
  pending: number
  lastSeenAt: string
  latestReason: string
  occurrences: LibraryRowOccurrence[]
}

const STATUS_LABEL: Record<LibraryStatus, string> = {
  adopted: '已接入',
  rejected: '不感兴趣',
  pending: '待处理',
}

const STATUS_CLASS: Record<LibraryStatus, string> = {
  adopted: 'chip verified',
  rejected: 'chip subtle',
  pending: 'chip release',
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '未知' : date.toLocaleString('zh-CN')
}

export default async function LibraryPage({ searchParams }: LibraryPageProps) {
  const params = await searchParams
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')

  const tab: LibraryTab =
    params.tab === 'watch'
      ? 'watch'
      : params.tab === 'maintainer'
        ? 'maintainer'
        : params.tab === 'comparison'
          ? 'comparison'
          : params.tab === 'discoverability'
            ? 'discoverability'
            : 'integration'
  const requestedStatus = params.status
  const status: LibraryStatus | null =
    requestedStatus === 'pending' || requestedStatus === 'adopted' || requestedStatus === 'rejected'
      ? requestedStatus === 'rejected' && tab === 'discoverability'
        ? null
        : requestedStatus
      : null
  const query = (params.q ?? '').trim().slice(0, 80)
  const sort = params.sort === 'count' ? 'count' : 'recent'
  const pool = getPool()
  const userId = Number(currentUser.id)
  const [integration, watch, maintainer, comparison, discoverability] = await Promise.all([
    loadIntegrationLibrary(pool, userId),
    loadWatchLibrary(pool, userId),
    loadMaintainerLibrary(pool, userId),
    loadComparisonLibrary(pool, userId),
    loadDiscoverabilityLibrary(pool, userId),
  ])

  const rows: LibraryRow[] = (() => {
    if (tab === 'watch') {
      return watch.items.map((item) => ({
        repo: item.repo,
        targetHref: `/r/${item.repo}`,
        total: item.total,
        groups: item.intents,
        meta: `命中 ${item.intents.length} 个关注目标 · 最近 ${formatDate(item.lastSeenAt)}`,
        adopted: item.adopted,
        rejected: item.rejected,
        pending: item.pending,
        lastSeenAt: item.lastSeenAt,
        latestReason: item.latestReason,
        occurrences: item.occurrences.map((occurrence) => ({
          title: occurrence.intent,
          detail: occurrence.reason,
          at: occurrence.at,
          status: occurrence.status,
          href: '/watch',
        })),
      }))
    }
    if (tab === 'maintainer') {
      return maintainer.items.map((item) => ({
        repo: item.label,
        targetHref: item.occurrences[0]?.href ?? '/maintain',
        total: item.total,
        groups: [item.project],
        meta: `出现在 ${item.reports} 份维护周报 · ${item.kind === 'item' ? 'Issue/PR 待办' : '依赖升级'} · 最近 ${formatDate(item.lastSeenAt)}`,
        adopted: item.adopted,
        rejected: item.rejected,
        pending: item.pending,
        lastSeenAt: item.lastSeenAt,
        latestReason: item.latestDetail,
        occurrences: item.occurrences.map((occurrence) => ({
          title: occurrence.label,
          detail: occurrence.detail,
          at: occurrence.generatedAt,
          status: occurrence.status,
          href: occurrence.href,
        })),
      }))
    }
    if (tab === 'comparison') {
      return comparison.items.map((item) => ({
        repo: item.repo,
        targetHref: `/r/${item.repo}`,
        total: item.total,
        groups: item.projects,
        meta: `出现在 ${item.reports} 份对比 · 被推荐 ${item.recommended} 次 · 最近 ${formatDate(item.lastSeenAt)}`,
        adopted: item.adopted,
        rejected: item.rejected,
        pending: item.pending,
        lastSeenAt: item.lastSeenAt,
        latestReason: item.latestReason,
        occurrences: item.occurrences.map((occurrence) => ({
          title: `${occurrence.project} · 对比 #${occurrence.reportId}`,
          detail: `${occurrence.recommended ? '本次推荐 · ' : ''}匹配度 ${occurrence.fitScore}：${occurrence.reason}`,
          at: occurrence.generatedAt,
          status: occurrence.status,
          href: occurrence.href,
        })),
      }))
    }
    if (tab === 'discoverability') {
      return discoverability.items.map((item) => ({
        repo: item.repo,
        targetHref: `/repos/${item.repo}/optimize`,
        statusLabels: { adopted: '已应用', pending: '未应用', rejected: '不感兴趣' },
        total: item.total,
        groups: [],
        meta: `${item.total} 份曝光报告 · 最新 ${item.latestScore} 分 · 最高 ${item.bestScore} 分 · 最近 ${formatDate(item.lastSeenAt)}`,
        adopted: item.applied,
        rejected: 0,
        pending: item.pending,
        lastSeenAt: item.lastSeenAt,
        latestReason: `最新可发现性评分 ${item.latestScore}/100，最高 ${item.bestScore}/100。`,
        occurrences: item.occurrences.map((occurrence) => ({
          title: `曝光分析 #${occurrence.reportId} · ${occurrence.score} 分`,
          detail: occurrence.appliedAt ? `已应用（${formatDate(occurrence.appliedAt)}）` : '尚未应用建议',
          at: occurrence.generatedAt,
          status: occurrence.appliedAt ? 'adopted' : 'pending',
          href: occurrence.href,
        })),
      }))
    }
    return integration.items.map((item) => ({
      repo: item.repo,
      targetHref: `/r/${item.repo}`,
      total: item.total,
      groups: item.projects,
      meta: `出现在 ${item.reports} 份报告 · ${item.projects.length} 个项目 · 最近 ${formatDate(item.lastSeenAt)}`,
      adopted: item.adopted,
      rejected: item.rejected,
      pending: item.pending,
      lastSeenAt: item.lastSeenAt,
      latestReason: item.latestReason,
      occurrences: item.occurrences.map((occurrence) => ({
        title: `${occurrence.project} · 报告 #${occurrence.reportId}`,
        detail: occurrence.reason,
        at: occurrence.generatedAt,
        status: occurrence.status,
        href: `/integrations?report=${occurrence.reportId}`,
      })),
    }))
  })()

  const needle = query.toLowerCase()
  const filtered = rows
    .filter((row) => {
      if (status && row[status] === 0) return false
      if (!needle) return true
      return [row.repo, ...row.groups, row.latestReason, ...row.occurrences.map((item) => item.detail)]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    })
    .sort((left, right) =>
      sort === 'count'
        ? right.total - left.total || Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt)
        : Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt) || right.total - left.total,
    )

  function href(overrides: Partial<{ tab: LibraryTab; status: LibraryStatus | null; q: string; sort: string }>): string {
    const next = { tab, status, q: query, sort, ...overrides }
    const search = new URLSearchParams({ tab: next.tab })
    if (next.status) search.set('status', next.status)
    if (next.q) search.set('q', next.q)
    if (next.sort === 'count') search.set('sort', 'count')
    return `/library?${search.toString()}`
  }

  const totals =
    tab === 'watch'
      ? {
          items: watch.totals.items,
          occurrences: watch.totals.matches,
          adopted: watch.totals.adopted,
          rejected: watch.totals.rejected,
          pending: watch.totals.pending,
          context: `${watch.totals.intents} 个关注目标`,
        }
      : tab === 'maintainer'
        ? {
            items: maintainer.totals.items,
            occurrences: maintainer.totals.occurrences,
            adopted: maintainer.totals.adopted,
            rejected: maintainer.totals.rejected,
            pending: maintainer.totals.pending,
            context: `${maintainer.totals.reports} 份维护周报`,
          }
        : tab === 'comparison'
          ? {
              items: comparison.totals.items,
              occurrences: comparison.totals.occurrences,
              adopted: comparison.totals.adopted,
              rejected: comparison.totals.rejected,
              pending: comparison.totals.pending,
              context: `${comparison.totals.reports} 份对比 · ${comparison.totals.projects} 个项目`,
            }
          : tab === 'discoverability'
            ? {
                items: discoverability.totals.items,
                occurrences: discoverability.totals.reports,
                adopted: discoverability.totals.applied,
                rejected: 0,
                pending: discoverability.totals.pending,
                context: `${discoverability.totals.reports} 份曝光报告`,
              }
            : {
                items: integration.totals.items,
                occurrences: integration.totals.occurrences,
                adopted: integration.totals.adopted,
                rejected: integration.totals.rejected,
                pending: integration.totals.pending,
                context: `${integration.totals.reports} 份历史报告`,
              }
  const statusLabels: Record<LibraryStatus, string> =
    tab === 'discoverability'
      ? { adopted: '已应用', rejected: '不感兴趣', pending: '未应用' }
      : STATUS_LABEL

  return (
    <div className="page">
      <section className="feed-head">
        <div>
          <p className="eyebrow">建议库</p>
          <h1>所有历史推荐，按库汇总</h1>
          <p className="feed-meta">
            不再只看单篇报告：接入、关注、维护、选型对比和曝光优化都按库或条目汇总；出现次数、已处理、已忽略和未处理都在这里。
          </p>
        </div>
        <div className="feed-actions">
          <Link className="btn small" href="/integrations">
            接入建议
          </Link>
          <Link className="btn quiet small" href="/watch">
            关注代理
          </Link>
          <Link className="btn quiet small" href="/history">
            生成历史
          </Link>
        </div>
      </section>

      <div className="library-tabs">
        <Link
          className={tab === 'integration' ? 'feed-tab active' : 'feed-tab'}
          href={href({ tab: 'integration' })}
        >
          接入建议 · {integration.totals.items}
        </Link>
        <Link
          className={tab === 'watch' ? 'feed-tab active' : 'feed-tab'}
          href={href({ tab: 'watch' })}
        >
          关注命中 · {watch.totals.items}
        </Link>
        <Link
          className={tab === 'maintainer' ? 'feed-tab active' : 'feed-tab'}
          href={href({ tab: 'maintainer' })}
        >
          维护待办 · {maintainer.totals.items}
        </Link>
        <Link
          className={tab === 'comparison' ? 'feed-tab active' : 'feed-tab'}
          href={href({ tab: 'comparison' })}
        >
          选型对比 · {comparison.totals.items}
        </Link>
        <Link
          className={tab === 'discoverability' ? 'feed-tab active' : 'feed-tab'}
          href={href({ tab: 'discoverability' })}
        >
          曝光优化 · {discoverability.totals.items}
        </Link>
      </div>

      <div className="library-stat-grid">
        <div className="library-stat">
          <strong>{totals.items}</strong>
          <span>个去重后的库</span>
        </div>
        <div className="library-stat">
          <strong>{totals.occurrences}</strong>
          <span>{tab === 'watch' ? '次命中' : '条推荐'} · {totals.context}</span>
        </div>
        <div className="library-stat">
          <strong>{totals.pending}</strong>
          <span>{statusLabels.pending}</span>
        </div>
        <div className="library-stat">
          <strong>{totals.adopted}</strong>
          <span>{statusLabels.adopted}</span>
        </div>
        <div className="library-stat">
          <strong>{totals.rejected}</strong>
          <span>{statusLabels.rejected}</span>
        </div>
      </div>

      <form action="/library" method="get" className="feed-search">
        <input type="hidden" name="tab" value={tab} />
        {status ? <input type="hidden" name="status" value={status} /> : null}
        {sort === 'count' ? <input type="hidden" name="sort" value="count" /> : null}
        <input
          className="input"
          type="search"
          name="q"
          defaultValue={query}
          placeholder="搜索库名、项目、关注目标或推荐理由"
          spellCheck={false}
        />
        <button className="btn small" type="submit">
          搜索
        </button>
        {query ? (
          <Link className="btn quiet small" href={href({ q: '' })}>
            清除搜索
          </Link>
        ) : null}
      </form>

      <div className="filter-bar">
        <span className="filter-label">状态</span>
        <Link className={!status ? 'chip toggle active' : 'chip toggle'} href={href({ status: null })}>
          全部
        </Link>
        {(tab === 'discoverability'
          ? (['pending', 'adopted'] as LibraryStatus[])
          : (['pending', 'adopted', 'rejected'] as LibraryStatus[])
        ).map((value) => (
          <Link
            key={value}
            className={status === value ? 'chip toggle active' : 'chip toggle'}
            href={href({ status: value })}
          >
            {statusLabels[value]}
          </Link>
        ))}
        <span className="filter-label library-sort-label">排序</span>
        <Link
          className={sort === 'recent' ? 'chip toggle active' : 'chip toggle'}
          href={href({ sort: 'recent' })}
        >
          最近出现
        </Link>
        <Link
          className={sort === 'count' ? 'chip toggle active' : 'chip toggle'}
          href={href({ sort: 'count' })}
        >
          推荐次数
        </Link>
        <span className="filter-count">{filtered.length} 个库</span>
      </div>

      {filtered.length === 0 ? (
        <div className="empty">
          <p>{rows.length === 0 ? '还没有可汇总的历史建议。' : '没有符合筛选条件的库。'}</p>
          <p className="small">
            {rows.length === 0
              ? tab === 'watch'
                ? '先创建关注目标并运行匹配，命中的仓库会汇总到这里。'
                : tab === 'maintainer'
                  ? '先生成一份维护周报，Issue/PR 待办和依赖升级会汇总到这里。'
                  : tab === 'comparison'
                    ? '先对某个项目生成一次选型对比，候选会汇总到这里。'
                    : tab === 'discoverability'
                      ? '先对自己的仓库生成一次曝光优化，评分历史会汇总到这里。'
                      : '先生成一份接入建议，之后每个候选库都会汇总到这里。'
              : '试试清除筛选或换一个关键词。'}
          </p>
          {rows.length === 0 ? (
            <Link
              className="btn small"
              href={
                tab === 'watch'
                  ? '/watch'
                  : tab === 'maintainer'
                    ? '/maintain'
                    : tab === 'comparison'
                      ? '/integrations'
                      : tab === 'discoverability'
                        ? '/repos'
                        : '/integrations'
              }
            >
              {tab === 'watch'
                ? '创建关注目标'
                : tab === 'maintainer'
                  ? '生成维护周报'
                  : tab === 'comparison'
                    ? '生成选型对比'
                    : tab === 'discoverability'
                      ? '打开仓库管理'
                      : '生成接入建议'}
            </Link>
          ) : query || status ? (
            <Link className="btn small" href={href({ q: '', status: null })}>
              清除筛选
            </Link>
          ) : null}
        </div>
      ) : (
        <div className="library-list">
          {filtered.map((row) => (
            <article className="library-card" key={row.repo}>
              <header className="library-card-head">
                <div>
                  <Link className="repo-name" href={row.targetHref}>
                    {row.repo}
                  </Link>
                  <p className="muted small">{row.meta}</p>
                </div>
                <div className="library-statuses">
                  {row.pending > 0 ? (
                    <span className="chip release">
                      {row.statusLabels?.pending ?? statusLabels.pending} {row.pending}
                    </span>
                  ) : null}
                  {row.adopted > 0 ? (
                    <span className="chip verified">
                      {row.statusLabels?.adopted ?? statusLabels.adopted} {row.adopted}
                    </span>
                  ) : null}
                  {row.rejected > 0 ? (
                    <span className="chip subtle">
                      {row.statusLabels?.rejected ?? statusLabels.rejected} {row.rejected}
                    </span>
                  ) : null}
                </div>
              </header>
              <p className="library-reason">{row.latestReason}</p>
              <div className="chips">
                {row.groups.slice(0, 6).map((group) => (
                  <span className="chip subtle" key={group}>
                    {group}
                  </span>
                ))}
                {row.groups.length > 6 ? (
                  <span className="chip subtle">+{row.groups.length - 6}</span>
                ) : null}
              </div>
              <details className="library-evidence">
                <summary>
                  查看 {row.total} 条
                  {tab === 'watch'
                    ? '命中'
                    : tab === 'maintainer'
                      ? '跟进'
                      : tab === 'discoverability'
                        ? '报告'
                        : tab === 'comparison'
                          ? '对比'
                          : '推荐'}
                </summary>
                <ul>
                  {row.occurrences.map((occurrence, index) => (
                    <li key={`${occurrence.title}:${occurrence.at}:${index}`}>
                      <div className="suggestion-head">
                        <Link href={occurrence.href}>{occurrence.title}</Link>
                        <span className={STATUS_CLASS[occurrence.status]}>
                          {row.statusLabels?.[occurrence.status] ?? statusLabels[occurrence.status]}
                        </span>
                        <span className="library-time">{formatDate(occurrence.at)}</span>
                      </div>
                      <p className="muted small">{occurrence.detail}</p>
                    </li>
                  ))}
                </ul>
              </details>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
