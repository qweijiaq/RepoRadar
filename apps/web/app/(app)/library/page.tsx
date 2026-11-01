import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  HISTORY_LABEL,
  buildProjectIntegrationBrief,
  findLatestIntegrationReport,
  loadComparisonLibrary,
  loadDiscoverabilityLibrary,
  loadIntegrationLibrary,
  loadMaintainerLibrary,
  loadWatchLibrary,
  type HistoryKind,
  type LibraryStatus,
  getPool,
} from '@repo-radar/core'
import { auth } from '@/auth'
import { sessionUser } from '@/lib/session'
import { HistoryPanel } from './history-panel'
import {
  IntegrationProjectView,
  type IntegrationProjectGroup,
  type ProjectSuggestionView,
} from './integration-project-view'

export const dynamic = 'force-dynamic'

type LibraryTab =
  | 'integration'
  | 'watch'
  | 'maintainer'
  | 'comparison'
  | 'discoverability'
  | 'history'

interface LibraryPageProps {
  searchParams: Promise<{
    tab?: string
    status?: string
    q?: string
    sort?: string
    kind?: string
    page?: string
    view?: string
  }>
}

const HISTORY_KINDS = Object.keys(HISTORY_LABEL) as HistoryKind[]

function LibraryHeader() {
  return (
    <section className="feed-head">
      <div>
        <p className="eyebrow">建议库</p>
        <h1>所有历史推荐，按库汇总</h1>
        <p className="feed-meta">
          接入、关注、维护、选型对比和曝光优化都按库或条目汇总；历史报告也可以在这里回看。
        </p>
      </div>
      <div className="feed-actions">
        <Link className="btn small" href="/workbench/integrations">
          接入建议
        </Link>
        <Link className="btn quiet small" href="/workbench/watch">
          关注代理
        </Link>
        <Link className="btn quiet small" href="/library?tab=history">
          历史报告
        </Link>
      </div>
    </section>
  )
}

function LibraryTabs({
  active,
  counts,
}: {
  active: LibraryTab
  counts?: Partial<Record<LibraryTab, number>>
}) {
  const tabs: Array<{ value: LibraryTab; label: string }> = [
    { value: 'integration', label: '接入建议' },
    { value: 'watch', label: '关注命中' },
    { value: 'maintainer', label: '维护待办' },
    { value: 'comparison', label: '选型对比' },
    { value: 'discoverability', label: '曝光优化' },
    { value: 'history', label: '历史报告' },
  ]
  return (
    <div className="library-tabs">
      {tabs.map((item) => (
        <Link
          key={item.value}
          className={active === item.value ? 'feed-tab active' : 'feed-tab'}
          href={`/library?tab=${item.value}`}
        >
          {item.label}
          {counts?.[item.value] !== undefined ? ` · ${counts[item.value]}` : ''}
        </Link>
      ))}
    </div>
  )
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
            : params.tab === 'history'
              ? 'history'
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
  const view = params.view === 'project' ? 'project' : 'repo'
  const pool = getPool()
  const userId = Number(currentUser.id)
  if (tab === 'history') {
    const kind = params.kind && HISTORY_KINDS.includes(params.kind as HistoryKind)
      ? (params.kind as HistoryKind)
      : null
    const requestedPage = Number.parseInt(params.page ?? '', 10)
    const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1
    return (
      <div className="page">
        <LibraryHeader />
        <LibraryTabs active="history" />
        <HistoryPanel userId={userId} kind={kind} page={page} />
      </div>
    )
  }
  const [integration, watch, maintainer, comparison, discoverability] = await Promise.all([
    loadIntegrationLibrary(pool, userId),
    loadWatchLibrary(pool, userId),
    loadMaintainerLibrary(pool, userId),
    loadComparisonLibrary(pool, userId),
    loadDiscoverabilityLibrary(pool, userId),
  ])

  const libraryCounts = {
    integration: integration.totals.items,
    watch: watch.totals.items,
    maintainer: maintainer.totals.items,
    comparison: comparison.totals.items,
    discoverability: discoverability.totals.items,
  }

  if (tab === 'integration' && view === 'project') {
    const latestIntegration = await findLatestIntegrationReport(pool, userId)
    const byProject = new Map<string, Map<string, ProjectSuggestionView>>()
    for (const item of integration.items) {
      for (const occurrence of item.occurrences) {
        const repoMap = byProject.get(occurrence.project) ?? new Map<string, ProjectSuggestionView>()
        const existing = repoMap.get(item.repo)
        const candidate: ProjectSuggestionView = {
          repo: item.repo,
          status: occurrence.status,
          kind: occurrence.kind,
          action: occurrence.action,
          reason: occurrence.reason,
          steps: occurrence.steps,
          alreadyUsed: occurrence.alreadyUsed,
          lastSeenAt: occurrence.generatedAt,
          note: occurrence.note ?? null,
        }
        if (!existing || Date.parse(candidate.lastSeenAt) >= Date.parse(existing.lastSeenAt)) {
          repoMap.set(item.repo, candidate)
        }
        byProject.set(occurrence.project, repoMap)
      }
    }
    const groups: IntegrationProjectGroup[] = [...byProject.entries()]
      .map(([project, repoMap]) => {
        const suggestions = [...repoMap.values()].sort((left, right) => {
          if (left.status !== right.status) return left.status === 'pending' ? -1 : 1
          return Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt)
        })
        const pending = suggestions.filter((item) => item.status === 'pending')
        const adopted = suggestions.filter((item) => item.status === 'adopted').length
        const rejected = suggestions.filter((item) => item.status === 'rejected').length
        const reportProject = latestIntegration?.report.projects.find(
          (item) => item.repo.toLowerCase() === project.toLowerCase(),
        )
        const brief =
          pending.length > 0
            ? buildProjectIntegrationBrief(
                {
                  repo: project,
                  summary: reportProject?.summary ?? '来自历史接入建议的汇总',
                  gaps: reportProject?.gaps ?? [],
                  suggestions: pending.map((item) => ({
                    repo: item.repo,
                    kind: item.kind,
                    reason: item.reason,
                    action: item.action,
                    steps: item.steps,
                    alreadyUsed: item.alreadyUsed,
                  })),
                },
                { generatedAt: latestIntegration?.generatedAt },
              )
            : ''
        return {
          project,
          summary: reportProject?.summary ?? '来自历史接入建议的汇总',
          gaps: reportProject?.gaps ?? [],
          pending: pending.length,
          adopted,
          rejected,
          lastSeenAt: suggestions.reduce(
            (latest, item) => (Date.parse(item.lastSeenAt) > Date.parse(latest) ? item.lastSeenAt : latest),
            suggestions[0]?.lastSeenAt ?? '',
          ),
          brief,
          suggestions,
        } satisfies IntegrationProjectGroup
      })
      .sort(
        (left, right) =>
          right.pending - left.pending || Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt),
      )
    return (
      <div className="page">
        <LibraryHeader />
        <LibraryTabs active="integration" counts={libraryCounts} />
        <IntegrationProjectView groups={groups} />
      </div>
    )
  }

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
          href: '/workbench/watch',
        })),
      }))
    }
    if (tab === 'maintainer') {
      return maintainer.items.map((item) => ({
        repo: item.label,
        targetHref: item.occurrences[0]?.href ?? '/workbench/maintain',
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
        href: `/workbench/integrations?report=${occurrence.reportId}`,
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
      <LibraryHeader />

      <LibraryTabs active={tab} counts={libraryCounts} />

      {tab === 'integration' ? (
        <div className="library-view-toggle">
          <span className="chip toggle active">按库查看</span>
          <Link className="chip toggle" href="/library?tab=integration&view=project">
            按维护项目
          </Link>
        </div>
      ) : null}

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
                  ? '/workbench/watch'
                  : tab === 'maintainer'
                    ? '/workbench/maintain'
                    : tab === 'comparison'
                      ? '/workbench/integrations'
                      : tab === 'discoverability'
                        ? '/repos'
                        : '/workbench/integrations'
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
