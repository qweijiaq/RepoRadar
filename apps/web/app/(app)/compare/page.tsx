import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  buildComparisonBrief,
  findComparisonReportById,
  findLatestComparisonReport,
  loadHandledState,
  loadIntegrationLibrary,
  type LibraryStatus,
  getPool,
} from '@repo-radar/core'
import { enqueueComparisonAction } from '@/app/(app)/jobs/enqueue'
import { CopyIntegrationButton } from '@/app/(app)/workbench/integrations/copy-button'
import { auth } from '@/auth'
import { sessionUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

const SUPPORT_LABEL: Record<string, string> = {
  yes: '支持',
  partial: '部分',
  no: '不支持',
  unknown: '未知',
}

const EFFORT_LABEL: Record<string, string> = {
  low: '低成本',
  medium: '中等成本',
  high: '高成本',
}

interface ComparePageProps {
  searchParams: Promise<{ project?: string; report?: string; error?: string }>
}

export default async function ComparePage({ searchParams }: ComparePageProps) {
  const params = await searchParams
  const project = params.project?.trim() ?? ''
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')
  if (!project) redirect('/workbench/integrations')

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
          <Link href="/workbench/integrations">← 返回接入建议</Link>
        </p>
        <div className="empty">
          <p>还没有 {project} 的对比报告。</p>
          <p className="small">回到接入建议页，对项目卡片点击「对比候选」。</p>
        </div>
      </div>
    )
  }

  const [handled, library] = await Promise.all([
    loadHandledState(getPool(), Number(currentUser.id)),
    loadIntegrationLibrary(getPool(), Number(currentUser.id)),
  ])
  function candidateStatus(repo: string): LibraryStatus | null {
    const pair = `${latest!.report.project}|${repo}`.toLowerCase()
    const outcome = handled.outcomes.get(pair)
    if (outcome) return outcome
    const key = `integration:${latest!.report.project}:${repo}`.toLowerCase()
    if (handled.dismissed.has(key)) return 'rejected'
    if (handled.done.has(key)) return 'adopted'
    return null
  }
  const remainingCandidates = latest.report.candidates.filter(
    (candidate) => candidateStatus(candidate.repo) === null,
  )
  const recommendedHandled = remainingCandidates.every(
    (candidate) => candidate.repo !== latest.report.recommendation.repo,
  )
  const fallbackRecommendation = remainingCandidates
    .slice()
    .sort((left, right) => right.fitScore - left.fitScore)[0]
  const filteredReport = {
    ...latest,
    report: {
      ...latest.report,
      candidates: remainingCandidates,
      recommendation: recommendedHandled && fallbackRecommendation
        ? {
            repo: fallbackRecommendation.repo,
            reason: `原推荐已处理，改选当前未处理候选里匹配度最高的 ${fallbackRecommendation.repo}。`,
          }
        : latest.report.recommendation,
    },
  }
  const brief = remainingCandidates.length >= 2 ? buildComparisonBrief(filteredReport) : ''
  const pickerCandidates = library.items
    .filter(
      (item) =>
        item.pending > 0 &&
        item.projects.some((itemProject) => itemProject.toLowerCase() === project.toLowerCase()),
    )
    .slice(0, 40)
  return (
    <div className="page narrow">
      <p className="muted small">
        <Link href="/workbench/integrations">← 返回接入建议</Link>
      </p>
      {params.error === 'compare-candidates' ? (
        <div className="notice">至少选择 2 个候选才能生成对比。</div>
      ) : null}
      {params.error === 'compare-token' ? (
        <div className="notice">生成对比需要 GitHub 授权，请重新登录后再试。</div>
      ) : null}
      {params.error === 'compare' ? <div className="notice">对比参数不正确。</div> : null}
      <section className="feed-head">
        <div>
          <p className="eyebrow">选型对比</p>
          <h1>{latest.report.project}</h1>
          <p className="feed-meta">{latest.report.summary}</p>
        </div>
        <div className="feed-actions">
          <Link className="btn small" href="/library?tab=history&kind=comparison">
            历史生成
          </Link>
          {remainingCandidates.length >= 2 ? (
            <CopyIntegrationButton
              text={brief}
              label={`复制对比给 AI（${remainingCandidates.length} 个未处理）`}
              className="btn small"
            />
          ) : (
            <span className="chip verified">候选都已处理</span>
          )}
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
        {candidateStatus(latest.report.recommendation.repo) === 'adopted' ? (
          <span className="chip verified">已接入</span>
        ) : null}
        {candidateStatus(latest.report.recommendation.repo) === 'rejected' ? (
          <span className="chip subtle">不感兴趣</span>
        ) : null}
        <p className="muted">{latest.report.recommendation.reason}</p>
        {recommendedHandled && fallbackRecommendation ? (
          <p className="muted small">
            原推荐已处理，复制任务书时会改用当前未处理候选里匹配度最高的{' '}
            {fallbackRecommendation.repo}。
          </p>
        ) : null}
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
              {candidateStatus(candidate.repo) === 'adopted' ? (
                <span className="chip verified">已接入</span>
              ) : null}
              {candidateStatus(candidate.repo) === 'rejected' ? (
                <span className="chip subtle">不感兴趣</span>
              ) : null}
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

      {latest.report.capabilities.length > 0 ? (
        <section className="panel">
          <h2>能力差异</h2>
          <div className="capability-table-wrap">
            <table className="capability-table">
              <thead>
                <tr>
                  <th>能力</th>
                  <th>{project}</th>
                  {latest.report.candidates.map((candidate) => (
                    <th key={candidate.repo}>{candidate.repo}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {latest.report.capabilities.map((row) => (
                  <tr key={row.name}>
                    <th scope="row">
                      {row.name}
                      {row.note ? <span className="muted small"> {row.note}</span> : null}
                    </th>
                    <td>{SUPPORT_LABEL[row.support[project] ?? 'unknown']}</td>
                    {latest.report.candidates.map((candidate) => (
                      <td key={candidate.repo}>
                        {SUPPORT_LABEL[row.support[candidate.repo] ?? 'unknown']}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            能力项由模型从 README 和元数据推断；没有依据的维度标为「未知」，替换前请自行验证。
          </p>
        </section>
      ) : null}

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

      <section className="panel">
        <details className="collapsible-section" open={remainingCandidates.length < 2}>
          <summary className="collapsible-summary">
            <span>从建议库换候选重新对比</span>
            <span className="muted small">{pickerCandidates.length} 个未处理候选</span>
          </summary>
          {pickerCandidates.length >= 2 ? (
            <form action={enqueueComparisonAction} className="compare-picker">
              <input type="hidden" name="project" value={project} />
              <input
                type="hidden"
                name="returnTo"
                value={`/compare?project=${encodeURIComponent(project)}`}
              />
              <p className="muted small">
                勾选 2-5 个候选，重新生成一份对比报告。已接入和不感兴趣的候选不会出现在这里。
              </p>
              <div className="compare-picker-grid">
                {pickerCandidates.map((item, index) => (
                  <label className="compare-picker-item" key={item.repo}>
                    <input
                      type="checkbox"
                      name="repos"
                      value={item.repo}
                      defaultChecked={index < 3}
                    />
                    <span>{item.repo}</span>
                    <span className="muted small">
                      待处理 {item.pending}
                      {item.total > item.pending ? ` / 历史 ${item.total}` : ''}
                    </span>
                  </label>
                ))}
              </div>
              <div className="form-actions">
                <button className="btn solid small" type="submit">
                  重新生成对比
                </button>
              </div>
            </form>
          ) : (
            <p className="muted small">
              这个项目在建议库里还没有足够的未处理候选，先去接入页生成新的建议。
            </p>
          )}
        </details>
      </section>
    </div>
  )
}
