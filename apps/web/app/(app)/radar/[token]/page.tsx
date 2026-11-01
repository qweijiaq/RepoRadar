import Link from 'next/link'
import { notFound } from 'next/navigation'
import { findRadarSnapshot, RADAR_MODES, getPool } from '@repo-radar/core'

export const dynamic = 'force-dynamic'

interface SharedRadarPageProps {
  params: Promise<{ token: string }>
}

export async function generateMetadata({ params }: SharedRadarPageProps) {
  const { token } = await params
  const snapshot = await findRadarSnapshot(getPool(), token)
  if (!snapshot) return { title: 'RepoRadar 分享雷达' }
  const description = `${snapshot.persona.name}：${snapshot.persona.detail}`
  return {
    title: `${snapshot.login} 的雷达 · RepoRadar`,
    description,
    openGraph: { type: 'article', title: `${snapshot.login} 的雷达`, description },
    twitter: { card: 'summary_large_image', title: `${snapshot.login} 的雷达`, description },
  }
}

export default async function SharedRadarPage({ params }: SharedRadarPageProps) {
  const { token } = await params
  const snapshot = await findRadarSnapshot(getPool(), token)
  if (!snapshot) notFound()
  const mode = RADAR_MODES.find((item) => item.value === snapshot.mode)

  return (
    <div className="page">
      <section className="feed-head">
        <div>
          <p className="eyebrow">分享雷达</p>
          <h1>{snapshot.login} 的雷达</h1>
          <p className="feed-meta">
            {mode?.label ?? snapshot.mode} · {snapshot.persona.name} · {snapshot.persona.detail}
          </p>
        </div>
        <div className="feed-actions">
          <Link className="btn small" href="/feed">
            打开我的雷达
          </Link>
        </div>
      </section>

      {snapshot.opportunities.length > 0 ? (
        <section className="radar-section">
          <div className="radar-section-head">
            <h2>正在处理的事</h2>
            <span className="radar-count">{snapshot.opportunities.length} 条</span>
          </div>
          <div className="opportunity-grid">
            {snapshot.opportunities.map((item, index) => (
              <article className="opportunity-card" key={`${item.kind}-${index}`}>
                <div className="opportunity-head">
                  <span className="chip used">{item.kind}</span>
                </div>
                <h3>{item.title}</h3>
                <p className="muted">{item.detail}</p>
                <div className="chips">
                  {item.evidence.map((evidence) => (
                    <span className="chip subtle" key={evidence}>
                      {evidence}
                    </span>
                  ))}
                </div>
                {item.repo ? (
                  <a
                    className="btn quiet small"
                    href={`https://github.com/${item.repo}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    看项目
                  </a>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {snapshot.gems.length > 0 ? (
        <section className="radar-section">
          <div className="radar-section-head">
            <h2>隐藏宝石</h2>
            <span className="radar-count">{snapshot.gems.length} 个</span>
          </div>
          <div className="gem-grid">
            {snapshot.gems.map((gem) => (
              <article className="gem-card" key={gem.repo}>
                <div className="gem-head">
                  <a className="repo-name" href={gem.htmlUrl} target="_blank" rel="noreferrer">
                    {gem.repo}
                  </a>
                  <span className="repo-stars">★ {gem.stars}</span>
                </div>
                <p className="gem-desc">{gem.description || '暂无描述'}</p>
                <div className="chips">
                  {gem.reasons.map((reason) => (
                    <span className="chip used" key={reason}>
                      {reason}
                    </span>
                  ))}
                </div>
                <div className="gem-foot">
                  <span className="muted small">{gem.language ?? '未知语言'}</span>
                  <a className="btn quiet small" href={gem.htmlUrl} target="_blank" rel="noreferrer">
                    GitHub
                  </a>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <p className="muted small">
        生成于 {new Date(snapshot.createdAt).toLocaleString('zh-CN')} · 由 RepoRadar 分享
      </p>
    </div>
  )
}
