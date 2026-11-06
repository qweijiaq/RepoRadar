import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  computeTrendStats,
  findEnrichedRepos,
  getPool,
  loadRecentReleaseEvents,
  loadStarHistory,
  loadTrendReport,
  risingRepos,
} from '@repo-radar/core'
import { auth } from '@/auth'
import { StarChart } from '@/components/StarChart'
import { sessionUser } from '@/lib/session'

export const dynamic = 'force-dynamic'
export const metadata = { title: '趋势简报 — RepoRadar' }

export default async function TrendsPage() {
  const session = await auth()
  if (!sessionUser(session)) redirect('/login')

  const pool = getPool()
  const [repos, report] = await Promise.all([findEnrichedRepos(pool, 500), loadTrendReport(pool)])
  const rising = risingRepos(repos, 8)
  const [histories, releases] = await Promise.all([
    Promise.all(rising.slice(0, 4).map((repo) => loadStarHistory(pool, repo.id, 14))),
    loadRecentReleaseEvents(pool, 7, 8),
  ])
  const stats = report?.stats ?? (await computeTrendStats(pool))
  const brief = report?.brief ?? null

  const topicCounts = new Map<string, number>()
  for (const repo of repos) {
    for (const topic of repo.topics) topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1)
  }
  const topics = [...topicCounts.entries()].sort((left, right) => right[1] - left[1]).slice(0, 12)
  const maxCount = topics[0]?.[1] ?? 1

  return (
    <div className="page">
      <p className="breadcrumb">
        <Link href="/feed">← 返回雷达</Link>
      </p>

      <section className="feed-head">
        <div>
          <p className="eyebrow">趋势</p>
          <h1>本周开源在涨什么</h1>
          <p className="feed-meta">
            基于近 7 天 star 相对增速、主题分布和 release 事件；AI 简报由 worker 每 12 小时生成。
            想按需求找库可以去 <Link href="/discover">意图搜索</Link>，想发分享卡去
            <Link href="/share/trending">生成分享卡</Link>，每日 Top10 在 <Link href="/daily">每日榜单</Link>。
          </p>
        </div>
        <div className="feed-actions">
          <a className="btn quiet small" href="/rss.xml">
            RSS
          </a>
          <a className="btn quiet small" href="/api/public/daily">
            每日 JSON
          </a>
        </div>
      </section>

      {repos.length === 0 ? (
        <div className="notice">
          候选池还没有数据。管理员可以在设置页刷新候选池，或等待 worker 自动采集。
        </div>
      ) : null}

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
        <h2>上升最快</h2>
        {rising.length === 0 ? (
          <p className="muted small">star 增速数据还在积累，每日采集几天后会更有信号。</p>
        ) : (
          <div className="repo-grid">
            {rising.map((repo, index) => (
              <article className="repo-card" key={repo.fullName}>
                <header className="repo-card-head">
                  <Link className="repo-name" href={`/r/${repo.owner}/${repo.name}`}>
                    {repo.fullName}
                  </Link>
                  <span className="repo-stars">★ {repo.stars.toLocaleString('en-US')}</span>
                </header>
                <p className="repo-summary">
                  7 天 +{(repo.growth * 100).toFixed(1)}% · {repo.language ?? '未知语言'}
                </p>
                {histories[index] && histories[index]!.length > 1 ? (
                  <StarChart points={histories[index]!} height={70} />
                ) : (
                  <p className="muted small">star 历史积累中</p>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <h2>新库速度榜（建库以来日均 star）</h2>
        <p className="muted small">
          给还没有 7 天快照的新库一个曝光位：按「当前 star ÷ 建库天数」排序，只统计近一年创建、至少 500 star 的项目。
        </p>
        {stats.velocity.length === 0 ? (
          <p className="muted small">还没有符合条件的新库。</p>
        ) : (
          <div className="admin-user-table">
            <div className="admin-user-row admin-user-head">
              <span>仓库</span>
              <span>日均 star</span>
              <span>stars</span>
              <span>建库</span>
            </div>
            {stats.velocity.map((repo) => (
              <div className="admin-user-row" key={repo.fullName}>
                <span>
                  <Link href={`/r/${repo.fullName}`}>{repo.fullName}</Link>
                  <small className="muted">{repo.summary?.slice(0, 40) ?? ''}</small>
                </span>
                <span>{repo.starsPerDay.toLocaleString('en-US')}</span>
                <span>{repo.stars.toLocaleString('en-US')}</span>
                <span>{new Date(repo.createdAt).toLocaleDateString('zh-CN')}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="trend-grid">
        <section className="panel">
          <h2>主题热度</h2>
          {topics.length === 0 ? (
            <p className="muted small">还没有主题数据，采集并富化候选仓库后会显示。</p>
          ) : (
            <ul className="topic-bars">
              {topics.map(([topic, count]) => (
                <li key={topic}>
                  <span>{topic}</span>
                  <span className="topic-bar">
                    <span style={{ width: `${Math.round((count / maxCount) * 100)}%` }} />
                  </span>
                  <span className="muted small">{count}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel">
          <h2>本周新版本</h2>
          {releases.length === 0 ? (
            <p className="muted small">
              还没有同步 release 事件。worker 会定时检查，也可以在设置页确认 GitHub 授权状态。
            </p>
          ) : (
            <ul className="timeline">
              {releases.map((release) => (
                <li key={`${release.repoFullName}:${release.tag}`}>
                  <span className="timeline-date">
                    {release.publishedAt
                      ? new Date(release.publishedAt).toLocaleDateString('zh-CN')
                      : '未知'}
                  </span>
                  {release.url ? (
                    <a href={release.url} target="_blank" rel="noreferrer">
                      {release.repoFullName} {release.tag}
                    </a>
                  ) : (
                    <span>
                      {release.repoFullName} {release.tag}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="panel">
        <h2>topic 动量（按增速）</h2>
        {stats.topics.length === 0 ? (
          <p className="muted small">还没有聚合出明显的 topic 趋势。</p>
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
