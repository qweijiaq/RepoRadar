import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  buildDiscoverabilityBrief,
  findDiscoverabilityReportById,
  findLatestDiscoverabilityReport,
  findRepoByFullName,
  listDiscoverabilityHistory,
  listOwnedRepos,
} from '@repo-radar/core'
import { CopyIntegrationButton } from '@/app/workbench/integrations/copy-button'
import { enqueueDiscoverabilityAction } from '@/app/jobs/enqueue'
import { applyDiscoverabilityAction } from '@/app/repos/actions'
import { auth } from '@/auth'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { getPool } from '@/lib/db'
import { fetchGitHubRepo } from '@/lib/project-context'
import { resolveRepoAccess, sessionUser } from '@/lib/session'
import { GenerateDiscoverabilityButton } from './generate-button'

export const dynamic = 'force-dynamic'

interface OptimizePageProps {
  params: Promise<{ owner: string; name: string }>
  searchParams: Promise<{ error?: string; applied?: string; report?: string }>
}

export default async function OptimizePage({ params, searchParams }: OptimizePageProps) {
  const { owner, name } = await params
  const query = await searchParams
  const fullName = `${owner}/${name}`
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')

  const pool = getPool()
  const access = await resolveRepoAccess(session, currentUser.login)
  const requestedReport = Number(query.report)
  const [latestReport, selectedReport, dbRepo, githubRepo, owned, scoreHistory] = await Promise.all([
    findLatestDiscoverabilityReport(pool, Number(currentUser.id), fullName),
    Number.isFinite(requestedReport) && requestedReport > 0
      ? findDiscoverabilityReportById(pool, Number(currentUser.id), requestedReport)
      : Promise.resolve(null),
    findRepoByFullName(pool, fullName),
    access.access ? fetchGitHubRepo(fullName, access.access.token) : Promise.resolve(null),
    access.access ? listOwnedRepos(access.access.token) : Promise.resolve([]),
    listDiscoverabilityHistory(pool, Number(currentUser.id), fullName, 12),
  ])
  const latest = selectedReport ?? latestReport
  const repo = githubRepo ?? dbRepo
  const isPrivate = owned.some((item) => item.fullName.toLowerCase() === fullName.toLowerCase() && item.private)
  const brief = latest
    ? buildDiscoverabilityBrief(latest, { skipApplied: Boolean(latest.appliedAt) })
    : ''

  return (
    <div className="page narrow">
      <p className="muted small">
        <Link href="/repos">← 返回仓库管理</Link> · <Link href="/library?tab=history&kind=discoverability">历史生成</Link>
      </p>
      <section className="feed-head">
        <div>
          <p className="eyebrow">曝光优化</p>
          <h1>{fullName}</h1>
          <p className="feed-meta">
            从定位、搜索关键词、Topics、README 首屏和差异化出发，让真正需要这个项目的人更容易找到它。
          </p>
        </div>
        {access.access ? (
          <div className="feed-actions">
            <Link className="btn small" href="/library?tab=history&kind=discoverability">
              历史生成
            </Link>
            <form action={enqueueDiscoverabilityAction}>
              <input type="hidden" name="repo" value={fullName} />
              <GenerateDiscoverabilityButton />
            </form>
          </div>
        ) : null}
      </section>

      {query.applied === '1' ? <div className="notice success">描述和 Topics 已更新到 GitHub。</div> : null}
      {query.error === 'need-token' ? <div className="notice">需要 GitHub 授权才能分析仓库。</div> : null}
      {query.error === 'not-owned' ? <div className="notice">只能优化自己拥有的仓库。</div> : null}
      {query.error === 'not-found' ? <div className="notice">没有找到这个仓库。</div> : null}
      {query.error === 'generate' ? <div className="notice">生成失败，请检查模型配置或稍后重试。</div> : null}
      {query.error === 'format' ? <div className="notice">模型返回格式异常，已自动重试；仍然失败请换一个模型。</div> : null}
      {query.error === 'apply' ? <div className="notice">应用失败，请检查 GitHub 授权后重试。</div> : null}
      {query.error === 'no-report' ? <div className="notice">没有可应用的报告，请先生成一次分析。</div> : null}
      {repo?.isFork || repo?.archived ? (
        <div className="notice">Fork 或已归档仓库通常不会被推荐；优化前请先确认仓库状态。</div>
      ) : null}
      {isPrivate ? (
        <div className="notice">私有仓库不会被 GitHub 搜索发现；如果希望获得曝光，需要先评估是否公开。</div>
      ) : null}

      {repo ? (
        <section className="panel">
          <h2>当前信息</h2>
          <p className="muted">{repo.description || '还没有描述。'}</p>
          <div className="chips">
            {(repo.topics ?? []).length > 0 ? (
              repo.topics.map((topic) => (
                <span className="chip subtle" key={topic}>
                  {topic}
                </span>
              ))
            ) : (
              <span className="muted small">还没有 Topics</span>
            )}
          </div>
          <p className="muted small">
            {repo.language ?? '未知语言'} · ★ {repo.stars} · Fork {repo.forks} · Open issues {repo.openIssues}
            {repo.license ? ` · ${repo.license}` : ''}
          </p>
        </section>
      ) : null}

      {latest ? (
        <>
          <section className="panel discover-score-panel">
            <div>
              <p className="eyebrow">可发现性评分</p>
              <p className="discover-score">{latest.report.score}<span>/100</span></p>
              <p className="muted">{latest.report.summary}</p>
              <p className="muted small">
                {new Date(latest.generatedAt).toLocaleString('zh-CN')}
                {latest.model ? ` · ${latest.providerId ? `${latest.providerId} · ` : ''}${latest.model}` : ''}
                {selectedReport ? ' · 历史版本' : ''}
                {latest.appliedAt
                  ? ` · 已应用于 ${new Date(latest.appliedAt).toLocaleString('zh-CN')}`
                  : ' · 尚未应用'}
              </p>
              {latest.appliedAt ? (
                <p className="muted small">
                  这份报告的建议已写入 GitHub；复制任务书前请确认是否还需要重复执行。
                </p>
              ) : null}
            </div>
            <CopyIntegrationButton
              text={brief}
              label={latest.appliedAt ? '复制剩余优化建议' : '复制优化任务书'}
              className="btn small"
            />
          </section>

          <section className="panel">
            <h2>维度</h2>
            <ul className="dimension-list">
              {latest.report.dimensions.map((dimension) => (
                <li key={dimension.name}>
                  <div className="dimension-head">
                    <span>{dimension.name}</span>
                    <span className="muted small">{dimension.score}</span>
                  </div>
                  <div className="dimension-bar">
                    <span style={{ width: `${dimension.score}%` }} />
                  </div>
                  <p className="muted small">{dimension.comment}</p>
                </li>
              ))}
            </ul>
          </section>

          {scoreHistory.length > 1 ? (
            <section className="panel">
              <h2>评分历史</h2>
              <ul className="score-history">
                {scoreHistory.map((point) => (
                  <li key={point.id}>
                    <span className="score-history-date">
                      {new Date(point.generatedAt).toLocaleDateString('zh-CN')}
                    </span>
                    <span className="score-history-bar">
                      <span style={{ width: `${Math.max(0, Math.min(100, point.score))}%` }} />
                    </span>
                    <span className="muted small">{point.score} 分</span>
                    {point.appliedAt ? <span className="chip verified">已应用</span> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="panel">
            <h2>建议</h2>
            <h3 className="maintain-subhead">新的描述</h3>
            <p className="suggested-description">{latest.report.suggestedDescription}</p>
            <h3 className="maintain-subhead">新的 Topics</h3>
            <div className="chips">
              {latest.report.suggestedTopics.length > 0 ? (
                latest.report.suggestedTopics.map((topic) => (
                  <span className="chip used" key={topic}>
                    {topic}
                  </span>
                ))
              ) : (
                <span className="muted small">模型没有给出可用 Topics。</span>
              )}
            </div>
            {latest.report.readmeSuggestions.length > 0 ? (
              <details className="collapsible-section" open={latest.report.readmeSuggestions.length <= 3}>
                <summary className="collapsible-summary">
                  <span>README 首屏建议</span>
                  <span className="muted small">{latest.report.readmeSuggestions.length} 条</span>
                </summary>
                <ul className="maintain-list">
                  {latest.report.readmeSuggestions.map((suggestion) => (
                    <li key={suggestion}>{suggestion}</li>
                  ))}
                </ul>
              </details>
            ) : null}
            {latest.report.actions.length > 0 ? (
              <details className="collapsible-section" open={latest.report.actions.length <= 3}>
                <summary className="collapsible-summary">
                  <span>执行动作</span>
                  <span className="muted small">{latest.report.actions.length} 项</span>
                </summary>
                <ul className="growth-actions">
                  {latest.report.actions.map((action) => (
                    <li key={action.title}>
                      <div className="dependency-head">
                        <strong>{action.title}</strong>
                        <span className={action.impact === 'high' ? 'chip release' : 'chip subtle'}>
                          {action.impact === 'high' ? '高影响' : action.impact === 'medium' ? '中影响' : '低影响'}
                        </span>
                      </div>
                      <p className="muted small">为什么：{action.why}</p>
                      <p className="muted small">怎么做：{action.how}</p>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {access.access ? (
              <div className="form-actions">
                <ConfirmDialog
                  action={applyDiscoverabilityAction}
                  fields={{ repo: fullName, report: String(latest.id ?? '') }}
                  triggerLabel="应用描述与 Topics"
                  triggerClassName="btn solid small"
                  title="应用曝光优化建议"
                  description="将用 AI 建议替换仓库描述和 Topics，README 不会自动修改。确认后立即写入 GitHub。"
                  confirmLabel="确认应用"
                />
              </div>
            ) : null}
          </section>

          {latest.report.problems.length > 0 ? (
            <section className="panel">
              <details className="collapsible-section" open={latest.report.problems.length <= 3}>
                <summary className="collapsible-summary">
                  <span>主要问题</span>
                  <span className="muted small">{latest.report.problems.length} 项</span>
                </summary>
                <ul className="maintain-list">
                  {latest.report.problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              </details>
              {latest.report.strengths.length > 0 ? (
                <details className="collapsible-section" open={latest.report.strengths.length <= 3}>
                  <summary className="collapsible-summary">
                    <span>可以保留的优势</span>
                    <span className="muted small">{latest.report.strengths.length} 项</span>
                  </summary>
                  <ul className="maintain-list">
                    {latest.report.strengths.map((strength) => (
                      <li key={strength}>{strength}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </section>
          ) : null}
        </>
      ) : (
        <div className="empty">
          <p>还没有分析过这个仓库。</p>
          <p className="small">
            {access.access ? '点击右上角开始分析。' : '需要 GitHub 授权后才能分析。'}
          </p>
        </div>
      )}
    </div>
  )
}
