import Link from 'next/link'
import { redirect } from 'next/navigation'
import { HISTORY_LABEL, listHistory, type HistoryKind } from '@repo-radar/core'
import { auth } from '@/auth'
import { getPool } from '@/lib/db'
import { sessionUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

const KINDS = Object.keys(HISTORY_LABEL) as HistoryKind[]

interface HistoryPageProps {
  searchParams: Promise<{ kind?: string }>
}

export default async function HistoryPage({ searchParams }: HistoryPageProps) {
  const params = await searchParams
  const requested = params.kind as HistoryKind | undefined
  const filter = requested && KINDS.includes(requested) ? requested : null
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')

  const entries = await listHistory(getPool(), Number(currentUser.id), 80)
  const filtered = filter ? entries.filter((entry) => entry.kind === filter) : entries

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
          <a className="btn small" href="/api/history/export">
            导出 JSON
          </a>
        </div>
      </section>

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
        <span className="filter-count">{filtered.length} 条</span>
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
    </div>
  )
}
