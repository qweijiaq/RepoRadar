import Link from 'next/link'
import { HISTORY_LABEL, listHistory, type HistoryKind } from '@repo-radar/core'
import { getPool } from '@/lib/db'

const KINDS = Object.keys(HISTORY_LABEL) as HistoryKind[]
const PAGE_SIZE = 40

function historyHref(kind: HistoryKind | null, page: number): string {
  const params = new URLSearchParams({ tab: 'history' })
  if (kind) params.set('kind', kind)
  if (page > 1) params.set('page', String(page))
  return `/library?${params.toString()}`
}

export async function HistoryPanel({
  userId,
  kind,
  page,
}: {
  userId: number
  kind: HistoryKind | null
  page: number
}) {
  const entries = await listHistory(
    getPool(),
    userId,
    PAGE_SIZE + 1,
    (page - 1) * PAGE_SIZE,
    kind ?? undefined,
  )
  const hasMore = entries.length > PAGE_SIZE
  const visible = entries.slice(0, PAGE_SIZE)

  return (
    <>
      <div className="filter-bar">
        <span className="filter-label">类型</span>
        <Link className={!kind ? 'chip toggle active' : 'chip toggle'} href={historyHref(null, 1)}>
          全部
        </Link>
        {KINDS.map((item) => (
          <Link
            key={item}
            className={kind === item ? 'chip toggle active' : 'chip toggle'}
            href={historyHref(item, 1)}
          >
            {HISTORY_LABEL[item]}
          </Link>
        ))}
        <span className="filter-count">
          第 {page} 页 · {visible.length} 条
        </span>
        <a className="btn quiet small" href="/api/history/export?full=1">
          导出完整 JSON
        </a>
      </div>

      {visible.length === 0 ? (
        <div className="empty">
          <p>还没有生成记录。</p>
          <p className="small">生成接入建议、维护周报或曝光优化后，会出现在这里。</p>
        </div>
      ) : (
        <ul className="history-list">
          {visible.map((entry) => (
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
            <Link className="btn small" href={historyHref(kind, page - 1)} scroll={false}>
              上一页
            </Link>
          ) : null}
          <span className="muted small">第 {page} 页</span>
          {hasMore ? (
            <Link className="btn small" href={historyHref(kind, page + 1)} scroll={false}>
              下一页
            </Link>
          ) : null}
        </div>
      ) : null}
    </>
  )
}
