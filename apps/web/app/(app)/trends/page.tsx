import Link from 'next/link'
import { redirect } from 'next/navigation'
import { computeTrendStats, getPool, loadTrendReport } from '@repo-radar/core'
import { auth } from '@/auth'
import { sessionUser } from '@/lib/session'

export const dynamic = 'force-dynamic'
export const metadata = { title: '趋势简报 — RepoRadar' }

export default async function TrendsPage() {
  const session = await auth()
  if (!sessionUser(session)) redirect('/login')

  const pool = getPool()
  const report = await loadTrendReport(pool)
  const stats = report?.stats ?? (await computeTrendStats(pool))
  const brief = report?.brief ?? null

  return (
    <div className="page">
      <section className="feed-head">
        <div>
          <p className="eyebrow">趋势</p>
          <h1>本周开源在涨什么</h1>
          <p className="feed-meta">
            基于近 7 天 star 相对增速、topic 动量和项目摘要生成；先看数据，再看 AI 简报。想按需求找库可以去
            <Link href="/discover">意图搜索</Link>。
          </p>
        </div>
      </section>

      {!brief ? (
        <div className="notice">
          AI 简报还没生成，下面是数据版趋势；worker 每 12 小时会自动生成一次。
        </div>
      ) : null}

      {brief ? (
        <section className="panel">
          <h2>{brief.headline}</h2>
          <ul className="maintain-list">
            {brief.points.map((point) => (
              <li key={point.title}>
                <strong>{point.title}</strong>：{point.detail}
                {point.repos.length > 0 ? (
                  <span className="muted small">
                    {' '}
                    （
                    {point.repos.map((repo, index) => (
                      <span key={repo}>
                        {index > 0 ? '、' : ''}
                        <Link href={`/r/${repo}`}>{repo}</Link>
                      </span>
                    ))}
                    ）
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          {brief.watch.length > 0 ? (
            <>
              <h3 className="maintain-subhead">值得继续观察</h3>
              <ul className="maintain-list">
                {brief.watch.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </>
          ) : null}
          <p className="muted small">
            由 {report?.model ?? '模型'} 生成于{' '}
            {report ? new Date(report.generatedAt).toLocaleString('zh-CN') : '未知'}；数字来自 star 快照。
          </p>
        </section>
      ) : null}

      <section className="panel">
        <h2>增长最快（7 天）</h2>
        {stats.risers.length === 0 ? (
          <p className="muted">还没有足够的 7 天 star 快照，先积累几天数据。</p>
        ) : (
          <div className="admin-user-table">
            <div className="admin-user-row admin-user-head">
              <span>仓库</span>
              <span>7 天增速</span>
              <span>stars</span>
              <span>语言</span>
            </div>
            {stats.risers.slice(0, 10).map((repo) => (
              <div className="admin-user-row" key={repo.fullName}>
                <span>
                  <Link href={`/r/${repo.fullName}`}>{repo.fullName}</Link>
                </span>
                <span>{(repo.growth * 100).toFixed(1)}%</span>
                <span>{repo.stars.toLocaleString('en-US')}</span>
                <span>{repo.language ?? '—'}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <h2>topic 动量</h2>
        {stats.topics.length === 0 ? (
          <p className="muted">还没有聚合出明显的 topic 趋势。</p>
        ) : (
          <div className="discover-intent">
            {stats.topics.map((topic) => (
              <span className="chip subtle" key={topic.topic}>
                #{topic.topic} · {(topic.growth * 100).toFixed(1)}% · {topic.repos} 个
              </span>
            ))}
          </div>
        )}
      </section>

      {stats.newEntrants.length > 0 ? (
        <section className="panel">
          <h2>新项目（近 120 天创建）</h2>
          <ul className="maintain-list">
            {stats.newEntrants.map((repo) => (
              <li key={repo.fullName}>
                <Link href={`/r/${repo.fullName}`}>{repo.fullName}</Link>{' '}
                <span className="muted small">
                  ★ {repo.stars.toLocaleString('en-US')} · {repo.summary?.slice(0, 80) ?? ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
