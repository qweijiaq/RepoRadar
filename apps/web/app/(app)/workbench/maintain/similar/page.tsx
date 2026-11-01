import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  buildSimilarBrief,
  findLatestSimilarReport,
  findSimilarReportById,
  listUserProjects,
} from '@repo-radar/core'
import { enqueueSimilarComparisonAction } from '@/app/(app)/jobs/enqueue'
import { CopyIntegrationButton } from '@/app/(app)/workbench/integrations/copy-button'
import { auth } from '@/auth'
import { getPool } from '@/lib/db'
import { sessionUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

interface SimilarPageProps {
  searchParams: Promise<{ repo?: string; report?: string; error?: string }>
}

export default async function SimilarComparisonPage({ searchParams }: SimilarPageProps) {
  const params = await searchParams
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')
  const repo = params.repo?.trim() ?? ''

  if (!repo) {
    const projects = await listUserProjects(getPool(), Number(currentUser.id))
    const active = projects.filter((project) => project.active)
    const candidates = active.length > 0 ? active : projects.filter((project) => project.source === 'owned')
    return (
      <div className="page narrow">
        <p className="muted small">
          <Link href="/workbench/maintain">← 返回维护工作台</Link>
        </p>
        <section className="feed-head">
          <div>
            <p className="eyebrow">相似项目对比</p>
            <h1>选择一个维护中的项目</h1>
            <p className="feed-meta">
              不需要先生成维护周报。选一个项目，RepoRadar 会找出 GitHub 上的相似项目并对比可借鉴之处。
            </p>
          </div>
          <div className="feed-actions">
            <Link className="btn quiet small" href="/workbench/integrations#projects">
              管理项目列表
            </Link>
          </div>
        </section>

        {candidates.length === 0 ? (
          <div className="empty">
            <p>还没有正在维护的项目。</p>
            <p className="small">先在接入页添加项目或同步 GitHub 画像，再回来做相似项目对比。</p>
            <Link className="btn small" href="/workbench/integrations#projects">
              添加项目
            </Link>
          </div>
        ) : (
          <div className="project-library-list">
            {candidates.map((project) => (
              <article className="panel project-library-card" key={project.repoFullName}>
                <header className="project-library-head">
                  <div>
                    <Link className="repo-name" href={`/r/${project.repoFullName}`}>
                      {project.repoFullName}
                    </Link>
                    <p className="muted small">
                      {project.description || '暂无描述'}
                      {project.language ? ` · ${project.language}` : ''}
                    </p>
                  </div>
                  <div className="project-library-actions">
                    <Link
                      className="btn small"
                      href={`/workbench/maintain/similar?repo=${encodeURIComponent(project.repoFullName)}`}
                    >
                      开始相似对比
                    </Link>
                  </div>
                </header>
              </article>
            ))}
          </div>
        )}
      </div>
    )
  }

  const requestedReport = Number(params.report)
  const [latest, selected] = await Promise.all([
    findLatestSimilarReport(getPool(), Number(currentUser.id), repo),
    Number.isFinite(requestedReport) && requestedReport > 0
      ? findSimilarReportById(getPool(), Number(currentUser.id), requestedReport)
      : Promise.resolve(null),
  ])
  const report = selected ?? latest
  const maxSimilarity = report
    ? Math.max(...report.report.candidates.map((candidate) => candidate.similarity))
    : 0
  const returnTo = `/workbench/maintain/similar?repo=${encodeURIComponent(repo)}`

  return (
    <div className="page narrow">
      <p className="muted small">
        <Link href="/workbench/maintain">← 返回维护工作台</Link>
      </p>
      <section className="feed-head">
        <div>
          <p className="eyebrow">相似项目对比</p>
          <h1>{repo}</h1>
          <p className="feed-meta">
            找出 GitHub 上相似的项目，对比双方优劣、目标项目应保留的优势，以及可以借鉴的设计和工程实践。
          </p>
        </div>
        <div className="feed-actions">
          <form action={enqueueSimilarComparisonAction}>
            <input type="hidden" name="project" value={repo} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <button className="btn small" type="submit">
              {report ? '重新生成对比' : '开始对比'}
            </button>
          </form>
          {report ? (
            <CopyIntegrationButton text={buildSimilarBrief(report)} label="复制对比给 AI" className="btn small" />
          ) : null}
        </div>
      </section>

      {params.error ? <div className="notice">对比生成失败，请检查 GitHub 授权或稍后重试。</div> : null}
      {report && maxSimilarity < 45 ? (
        <div className="notice">
          没有找到足够接近的直接竞品（最高相似度 {maxSimilarity}）。下面的候选主要作为工程实践和产品形态的参考，不代表它们是同类产品。
        </div>
      ) : null}

      {report ? (
        <>
          <p className="muted small">
            {new Date(report.generatedAt).toLocaleString('zh-CN')}
            {report.model ? ` · ${report.providerId ? `${report.providerId} · ` : ''}${report.model}` : ''}
            {selected ? ' · 历史版本' : ''}
          </p>
          <section className="panel">
            <h2>整体判断</h2>
            <p className="muted">{report.report.summary}</p>
          </section>

          <div className="similar-report-grid">
            {report.report.candidates.map((candidate) => (
              <article className="panel similar-report-card" key={candidate.repo}>
                <header className="similar-report-head">
                  <Link className="repo-name" href={`/r/${candidate.repo}`}>
                    {candidate.repo}
                  </Link>
                  <span className="chip used">相似度 {candidate.similarity}</span>
                </header>
                <p className="muted">{candidate.overview}</p>
                <h3 className="maintain-subhead">对方更强的地方</h3>
                <ul className="maintain-list">
                  {candidate.candidateStrengths.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                {candidate.candidateWeaknesses.length > 0 ? (
                  <>
                    <h3 className="maintain-subhead">对方不如目标项目的地方</h3>
                    <ul className="maintain-list">
                      {candidate.candidateWeaknesses.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </>
                ) : null}
                {candidate.targetAdvantages.length > 0 ? (
                  <>
                    <h3 className="maintain-subhead">目标项目应保留的优势</h3>
                    <ul className="maintain-list">
                      {candidate.targetAdvantages.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </>
                ) : null}
                <h3 className="maintain-subhead">可以借鉴</h3>
                <ul className="maintain-list">
                  {candidate.borrowable.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                {candidate.risks.length > 0 ? (
                  <>
                    <h3 className="maintain-subhead">借鉴风险</h3>
                    <ul className="maintain-list">
                      {candidate.risks.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </article>
            ))}
          </div>

          {report.report.nextSteps.length > 0 ? (
            <section className="panel">
              <h2>建议下一步</h2>
              <ol className="maintain-actions">
                {report.report.nextSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </section>
          ) : null}
        </>
      ) : (
        <div className="empty">
          <p>还没有生成过这个项目的相似项目对比。</p>
          <p className="small">
            点击右上角「开始对比」，RepoRadar 会从已收录候选和 GitHub 现场搜索中找相似项目，再让模型对比可借鉴之处。
          </p>
        </div>
      )}
    </div>
  )
}
