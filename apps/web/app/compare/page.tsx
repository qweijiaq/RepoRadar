import Link from 'next/link'
import { redirect } from 'next/navigation'
import { buildComparisonBrief, findComparisonReportById, findLatestComparisonReport } from '@repo-radar/core'
import { CopyIntegrationButton } from '@/app/integrations/copy-button'
import { auth } from '@/auth'
import { getPool } from '@/lib/db'
import { sessionUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

const EFFORT_LABEL: Record<string, string> = {
  low: '低成本',
  medium: '中等成本',
  high: '高成本',
}

interface ComparePageProps {
  searchParams: Promise<{ project?: string; report?: string }>
}

export default async function ComparePage({ searchParams }: ComparePageProps) {
  const params = await searchParams
  const project = params.project?.trim() ?? ''
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')
  if (!project) redirect('/integrations')

  const requestedReport = Number(params.report)
  const [latestReport, selectedReport] = await Promise.all([
    findLatestComparisonReport(getPool(), Number(currentUser.id), project),
    Number.isFinite(requestedReport) && requestedReport > 0
      ? findComparisonReportById(getPool(), Number(currentUser.id), requestedReport)
      : Promise.resolve(null),
  ])
  const latest = selectedReport ?? latestReport
  if (!latest) {
    return (
      <div className="page narrow">
        <p className="muted small">
          <Link href="/integrations">← 返回接入建议</Link>
        </p>
        <div className="empty">
          <p>还没有 {project} 的对比报告。</p>
          <p className="small">回到接入建议页，对项目卡片点击「对比候选」。</p>
        </div>
      </div>
    )
  }

  const brief = buildComparisonBrief(latest)
  return (
    <div className="page narrow">
      <p className="muted small">
        <Link href="/integrations">← 返回接入建议</Link>
      </p>
      <section className="feed-head">
        <div>
          <p className="eyebrow">选型对比</p>
          <h1>{latest.report.project}</h1>
          <p className="feed-meta">{latest.report.summary}</p>
        </div>
        <div className="feed-actions">
          <Link className="btn small" href="/history?kind=comparison">
            历史生成
          </Link>
          <CopyIntegrationButton text={brief} label="复制对比给 AI" className="btn small" />
        </div>
      </section>

      <p className="muted small">
        {new Date(latest.generatedAt).toLocaleString('zh-CN')}
        {latest.model ? ` · ${latest.providerId ? `${latest.providerId} · ` : ''}${latest.model}` : ''}
        {selectedReport ? ' · 历史版本' : ''}
      </p>
      {latest.candidateRepos?.length ? (
        <details className="trace-details">
          <summary>本次对比候选</summary>
          <div className="chips">
            {latest.candidateRepos.map((repo) => (
              <span className="chip subtle" key={repo}>
                {repo}
              </span>
            ))}
          </div>
        </details>
      ) : null}

      <section className="panel compare-recommendation">
        <p className="eyebrow">推荐</p>
        <h2>{latest.report.recommendation.repo}</h2>
        <p className="muted">{latest.report.recommendation.reason}</p>
      </section>

      <div className="compare-grid">
        {latest.report.candidates.map((candidate) => (
          <article
            className={
              candidate.repo === latest.report.recommendation.repo
                ? 'panel compare-card recommended'
                : 'panel compare-card'
            }
            key={candidate.repo}
          >
            <header className="compare-head">
              <Link className="repo-name" href={`/r/${candidate.repo}`}>
                {candidate.repo}
              </Link>
              <span className="chip used">{candidate.fitScore}</span>
            </header>
            <p className="muted small">
              迁移成本：{EFFORT_LABEL[candidate.migrationEffort] ?? candidate.migrationEffort}
            </p>
            <p className="muted">{candidate.reason}</p>
            <h3 className="maintain-subhead">优势</h3>
            <ul className="maintain-list">
              {candidate.strengths.map((strength) => (
                <li key={strength}>{strength}</li>
              ))}
            </ul>
            {candidate.weaknesses.length > 0 ? (
              <>
                <h3 className="maintain-subhead">弱点</h3>
                <ul className="maintain-list">
                  {candidate.weaknesses.map((weakness) => (
                    <li key={weakness}>{weakness}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </article>
        ))}
      </div>

      {latest.report.nextSteps.length > 0 ? (
        <section className="panel">
          <h2>验证步骤</h2>
          <ol className="maintain-actions">
            {latest.report.nextSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p className="muted small">迁移成本是初步估算，真正替换前先用目标项目里的小范围 spike 验证。</p>
        </section>
      ) : null}
    </div>
  )
}
