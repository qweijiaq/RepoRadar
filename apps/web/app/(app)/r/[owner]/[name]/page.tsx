import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  findEnrichedRepos,
  findRepoByFullName,
  findSimilarRepos,
  listCollections,
  loadHandledState,
  loadReleaseHistory,
  loadStarHistory,
  loadUserStars,
  loadVerifications,
  type CollectionRecord,
  type EnrichedRepoRecord,
  getPool,
} from '@repo-radar/core'
import { addToCollectionAction } from '@/app/actions'
import { auth } from '@/auth'
import { StarChart } from '@/components/StarChart'
import { sessionUser } from '@/lib/session'

const VERIFY_STATUS_LABELS: Record<string, string> = {
  verified: '✅ 验证通过',
  failed: '❌ 构建失败',
  skipped: '⏭ 已跳过',
  error: '⚠️ 验证出错',
}

export const dynamic = 'force-dynamic'

interface RepoPageProps {
  params: Promise<{ owner: string; name: string }>
}

export async function generateMetadata({ params }: RepoPageProps) {
  const { owner, name } = await params
  const repo = await findRepoByFullName(getPool(), `${owner}/${name}`)
  if (!repo) return { title: '未找到项目 — RepoRadar' }
  const description = repo.summary ?? repo.description ?? undefined
  return {
    title: `${repo.fullName} — RepoRadar`,
    description,
    openGraph: {
      type: 'article',
      title: `${repo.fullName} — RepoRadar`,
      description,
    },
    twitter: { card: 'summary_large_image', title: repo.fullName, description },
  }
}

export default async function RepoPage({ params }: RepoPageProps) {
  const { owner, name } = await params
  const fullName = `${owner}/${name}`
  const pool = getPool()
  const repo = await findRepoByFullName(pool, fullName)
  if (!repo) notFound()

  const [verifications, history, releases, allRepos] = await Promise.all([
    loadVerifications(pool, fullName, 5),
    loadStarHistory(pool, repo.id, 30),
    loadReleaseHistory(pool, fullName, 8),
    findEnrichedRepos(pool, 500),
  ])
  const similar = findSimilarRepos(repo, allRepos, 4)
  const latestVerification = verifications[0] ?? null

  const session = await auth()
  const currentUser = sessionUser(session)
  let starred = new Set<string>()
  let nearest: { repo: EnrichedRepoRecord; similarity: number } | null = null
  let collections: CollectionRecord[] = []

  const adoptedProjects: string[] = []
  const rejectedProjects: string[] = []
  let markHandled = false
  if (currentUser) {
    starred = await loadUserStars(pool, Number(currentUser.id))
    const starredRepos = allRepos.filter((item) => starred.has(item.fullName))
    nearest = findSimilarRepos(repo, starredRepos, 1)[0] ?? null
    const [userCollections, handled] = await Promise.all([
      listCollections(pool, Number(currentUser.id)),
      loadHandledState(pool, Number(currentUser.id)),
    ])
    collections = userCollections
    const repoKey = repo.fullName.toLowerCase()
    for (const [pair, status] of handled.outcomes) {
      if (!pair.endsWith(`|${repoKey}`)) continue
      const project = pair.slice(0, pair.lastIndexOf('|'))
      if (status === 'adopted') adoptedProjects.push(project)
      else rejectedProjects.push(project)
    }
    markHandled =
      handled.done.has(`gem:${repoKey}`) ||
      [...handled.done].some((key) => key.startsWith('watch:') && key.endsWith(`:${repoKey}`))
  }

  return (
    <div className="page narrow">
      <p className="breadcrumb">
        <Link href="/feed">← 返回雷达</Link>
      </p>

      <nav className="repo-detail-toc" aria-label="仓库详情导航">
        <a href="#about">这是什么</a>
        <a href="#trend">star 走势</a>
        <a href="#releases">版本</a>
        <a href="#similar">同类项目</a>
        {currentUser ? <a href="#relation">和你的关系</a> : null}
        <a href="#verification">验证</a>
      </nav>

      <article className="repo-detail">
        <header className="repo-detail-head">
          <p className="eyebrow">{repo.language ?? 'Unknown language'}</p>
          <h1>{repo.fullName}</h1>
          <div className="repo-meta">
            <span>★ {repo.stars.toLocaleString('en-US')}</span>
            <span>{repo.license ?? '无许可证'}</span>
            <span>最近推送 {repo.pushedAt ? new Date(repo.pushedAt).toLocaleDateString('zh-CN') : '未知'}</span>
            {repo.verifyStatus === 'verified' ? <span className="chip verified">已验证</span> : null}
          </div>
        </header>

        <section className="panel" id="about">
          <h2>这是什么</h2>
          <p>{repo.summary ?? repo.description ?? '暂无摘要'}</p>
          {repo.problem ? (
            <>
              <h2>解决什么问题</h2>
              <p>{repo.problem}</p>
            </>
          ) : null}
          {repo.audience ? (
            <>
              <h2>适合谁</h2>
              <p>{repo.audience}</p>
            </>
          ) : null}
          {repo.reason ? (
            <>
              <h2>为什么值得看</h2>
              <p>{repo.reason}</p>
            </>
          ) : null}
        </section>

        <section className="panel" id="trend">
          <h2>star 走势（30 天）</h2>
          <StarChart points={history} />
        </section>

        <section className="panel" id="releases">
          <h2>版本时间线</h2>
          {releases.length > 0 ? (
            <ul className="timeline">
              {releases.map((release) => (
                <li key={`${release.tag}:${release.publishedAt ?? ''}`}>
                  <span className="timeline-date">
                    {release.publishedAt ? new Date(release.publishedAt).toLocaleDateString('zh-CN') : '未知日期'}
                  </span>
                  {release.url ? (
                    <a href={release.url} target="_blank" rel="noreferrer">
                      {release.tag}
                    </a>
                  ) : (
                    <span>{release.tag}</span>
                  )}
                  {release.name ? <span className="muted small">{release.name}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">
              还没有同步过 release 事件。订阅这个仓库或运行 <code>pnpm radar releases</code> 后会出现在这里。
            </p>
          )}
        </section>

        {similar.length > 0 ? (
          <section className="panel" id="similar">
            <h2>同类项目</h2>
            <ul className="similar-list">
              {similar.map(({ repo: item, similarity }) => (
                <li key={item.fullName}>
                  <Link href={`/r/${item.owner}/${item.name}`}>{item.fullName}</Link>
                  <span className="similar-meta">
                    {item.language ?? '未知语言'} · ★ {item.stars.toLocaleString('en-US')} ·{' '}
                    {Math.round(similarity * 100)}% 相似
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {currentUser ? (
          <section className="panel" id="relation">
            <h2>和你的关系</h2>
            <p className="muted small">
              {starred.has(repo.fullName) ? '你已经 star 过这个项目。' : '你还没有 star 过这个项目。'}
              {nearest
                ? `它和你 star 过的 ${nearest.repo.fullName} 最相似（${Math.round(nearest.similarity * 100)}%）。`
                : ''}
            </p>
            <div className="chips">
              {adoptedProjects.length > 0 ? (
                <span className="chip verified">
                  已接入 {adoptedProjects.length} 个项目
                </span>
              ) : null}
              {rejectedProjects.length > 0 ? (
                <span className="chip subtle">
                  不感兴趣 {rejectedProjects.length} 个项目
                </span>
              ) : null}
              {markHandled ? <span className="chip used">你已标记过这个项目</span> : null}
            </div>
          </section>
        ) : null}

        {currentUser ? (
          <section className="panel">
            <h2>加入收藏集</h2>
            {collections.length > 0 ? (
              <form action={addToCollectionAction} className="chips">
                <input type="hidden" name="repo" value={repo.fullName} />
                <input type="hidden" name="returnTo" value={`/r/${repo.owner}/${repo.name}`} />
                {collections.map((collection) => (
                  <button
                    key={collection.id}
                    type="submit"
                    name="collectionId"
                    value={collection.id}
                    className="chip toggle"
                  >
                    ＋ {collection.name}
                  </button>
                ))}
              </form>
            ) : (
              <p className="muted small">
                还没有收藏集。<Link href="/feed?tab=collections">创建一个</Link>。
              </p>
            )}
          </section>
        ) : null}

        <section className="panel" id="verification">
          <h2>验证状态</h2>
          {latestVerification ? (
            <>
              <p className="muted">
                {VERIFY_STATUS_LABELS[latestVerification.status] ?? latestVerification.status}
                {latestVerification.stack ? ` · ${latestVerification.stack}` : ''}
                {latestVerification.durationMs !== null
                  ? ` · ${(latestVerification.durationMs / 1000).toFixed(1)}s`
                  : ''}
                {latestVerification.verifiedAt
                  ? ` · ${new Date(latestVerification.verifiedAt).toLocaleString('zh-CN')}`
                  : ''}
              </p>
              {latestVerification.commands.length > 0 ? (
                <pre className="log-block">{latestVerification.commands.join('\n')}</pre>
              ) : null}
              {latestVerification.logTail ? (
                <details className="log-details">
                  <summary>查看构建日志</summary>
                  <pre className="log-block">{latestVerification.logTail}</pre>
                </details>
              ) : null}
              {verifications.length > 1 ? (
                <ul className="timeline">
                  {verifications.map((verification) => (
                    <li key={verification.id}>
                      <span className="timeline-date">
                        {verification.verifiedAt
                          ? new Date(verification.verifiedAt).toLocaleDateString('zh-CN')
                          : '未知日期'}
                      </span>
                      <span>{VERIFY_STATUS_LABELS[verification.status] ?? verification.status}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <p className="muted small">
              还没有验证记录。运行 <code>pnpm radar verify</code> 后会在这里出现。
            </p>
          )}
        </section>

        {repo.topics.length > 0 ? (
          <div className="chips">
            {repo.topics.map((topic) => (
              <span className="chip subtle" key={topic}>
                {topic}
              </span>
            ))}
          </div>
        ) : null}

        <div className="hero-actions">
          <a className="btn solid" href={repo.htmlUrl} target="_blank" rel="noreferrer">
            打开 GitHub 仓库
          </a>
          {repo.homepage ? (
            <a className="btn" href={repo.homepage} target="_blank" rel="noreferrer">
              项目主页
            </a>
          ) : null}
        </div>
      </article>
    </div>
  )
}
