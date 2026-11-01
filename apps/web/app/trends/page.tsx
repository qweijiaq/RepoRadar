import Link from 'next/link'
import { findEnrichedRepos, loadRecentReleaseEvents, loadStarHistory, risingRepos } from '@repo-radar/core'
import { StarChart } from '@/components/StarChart'
import { getPool } from '@/lib/db'

export const dynamic = 'force-dynamic'

export default async function TrendsPage() {
  const pool = getPool()
  const repos = await findEnrichedRepos(pool, 500)
  const rising = risingRepos(repos, 8)
  const histories = await Promise.all(rising.slice(0, 4).map((repo) => loadStarHistory(pool, repo.id, 14)))
  const releases = await loadRecentReleaseEvents(pool, 7, 8)

  const topicCounts = new Map<string, number>()
  for (const repo of repos) {
    for (const topic of repo.topics) topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1)
  }
  const topics = [...topicCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
  const maxCount = topics[0]?.[1] ?? 1

  return (
    <div className="page">
      <p className="breadcrumb">
        <Link href="/feed">← 返回雷达</Link>
      </p>

      <section className="feed-head">
        <div>
          <p className="eyebrow">趋势</p>
          <h1>正在发生什么</h1>
          <p className="feed-meta">基于已收录项目的 star 增速、主题分布和 release 事件。</p>
        </div>
      </section>

      {repos.length === 0 ? (
        <div className="notice">
          候选池还没有数据。管理员可以在设置页刷新候选池，或等待 worker 自动采集。
        </div>
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
            <p className="muted small">还没有同步 release 事件。worker 会定时检查，也可以在设置页确认 GitHub 授权状态。</p>
          ) : (
            <ul className="timeline">
              {releases.map((release) => (
                <li key={`${release.repoFullName}:${release.tag}`}>
                  <span className="timeline-date">
                    {release.publishedAt ? new Date(release.publishedAt).toLocaleDateString('zh-CN') : '未知'}
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
    </div>
  )
}
