import Link from 'next/link'
import { redirect } from 'next/navigation'
import { HISTORY_LABEL, listHistory, type HistoryKind } from '@repo-radar/core'
import { auth } from '@/auth'
import { getPool } from '@/lib/db'
import { sessionUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

const KINDS = Object.keys(HISTORY_LABEL) as HistoryKind[]

interface HistoryPageProps {
  searchParams: Promise<{ kind?: string; page?: string }>
}

const PAGE_SIZE = 40

function pageHref(kind: HistoryKind | null, page: number): string {
  const params = new URLSearchParams()
  if (kind) params.set('kind', kind)
  if (page > 1) params.set('page', String(page))
  const query = params.toString()
  return query ? `/history?${query}` : '/history'
}

export default async function HistoryPage({ searchParams }: HistoryPageProps) {
  const params = await searchParams
  const requested = params.kind as HistoryKind | undefined
  const filter = requested && KINDS.includes(requested) ? requested : null
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')

  const requestedPage = Number.parseInt(params.page ?? '', 10)
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1
  const offset = (page - 1) * PAGE_SIZE
  const entries = await listHistory(
    getPool(),
    Number(currentUser.id),
    PAGE_SIZE + 1,
    offset,
    filter ?? undefined,
  )
  const hasMore = entries.length > PAGE_SIZE
  const filtered = entries.slice(0, PAGE_SIZE)

  return (
    <div className="page narrow">
      <section className="feed-head">
        <div>
          <p className="eyebrow">历史生成</p>
          <h1>所有 AI 生成内容</h1>
          <p className="feed-meta">
            每次生成都会保留，重新生成不会覆盖旧版本。这里可以看到生成时间、使用的模型和原始内容。
          </p>
        </div>
        <div className="feed-actions">
          <Link
            className="btn small"
            href={`/library?tab=${
              filter === 'watch'
                ? 'watch'
                : filter === 'maintainer'
                  ? 'maintainer'
                  : filter === 'comparison'
                    ? 'comparison'
                    : filter === 'discoverability'
                      ? 'discoverability'
                      : 'integration'
            }`}
          >
            按库汇总
          </Link>
          <a className="btn quiet small" href="/api/history/export?full=1">
            导出完整 JSON
          </a>
        </div>
      </section>

      {filter && ['integration', 'watch', 'maintainer', 'comparison', 'discoverability'].includes(filter) ? (
        <div className="notice history-library-hint">
          历史报告适合回看单次生成；想按库或条目查看出现次数、已接入、不感兴趣和待处理，请打开{' '}
          <Link href={`/library?tab=${filter}`}>建议库</Link>。
        </div>
      ) : null}

      <div className="filter-bar">
        <span className="filter-label">类型</span>
        <Link className={!filter ? 'chip toggle active' : 'chip toggle'} href="/history">
          全部
        </Link>
        {KINDS.map((kind) => (
          <Link
            key={kind}
            className={filter === kind ? 'chip toggle active' : 'chip toggle'}
            href={`/history?kind=${kind}`}
          >
            {HISTORY_LABEL[kind]}
          </Link>
        ))}
        <span className="filter-count">第 {page} 页 · {filtered.length} 条</span>
      </div>

      {filtered.length === 0 ? (
        <div className="empty">
          <p>还没有生成记录。</p>
          <p className="small">生成接入建议、维护周报或曝光优化后，会出现在这里。</p>
        </div>
      ) : (
        <ul className="history-list">
          {filtered.map((entry) => (
            <li key={`${entry.kind}:${entry.id}`} className="history-row">
              <div className="history-main">
                <div className="history-head">
                  <span className="chip subtle">{HISTORY_LABEL[entry.kind]}</span>
                  <span className="history-time">
                    {new Date(entry.createdAt).toLocaleString('zh-CN')}
                  </span>
                </div>
                <Link className="history-title" href={entry.href}>
                  {entry.title}
                </Link>
                {entry.subtitle ? <p className="muted small">{entry.subtitle}</p> : null}
                <span className="history-model">
                  {entry.model
                    ? `${entry.providerId ? `${entry.providerId} · ` : ''}${entry.model}`
                    : '早期记录（未记录模型）'}
                </span>
              </div>
              <Link className="btn quiet small" href={entry.href}>
                查看
              </Link>
            </li>
          ))}
        </ul>
      )}

      {page > 1 || hasMore ? (
        <div className="history-pagination">
          {page > 1 ? (
            <Link className="btn small" href={pageHref(filter, page - 1)}>
              上一页
            </Link>
          ) : null}
          <span className="muted small">第 {page} 页</span>
          {hasMore ? (
            <Link className="btn small" href={pageHref(filter, page + 1)}>
              下一页
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
