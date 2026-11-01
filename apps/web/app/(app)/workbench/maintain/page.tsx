import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  filterMaintainerReport,
  buildMaintainerBrief,
  findLatestMaintainerReport,
  findMaintainerReportById,
  listUserProjects,
  loadHandledState,
  type MaintainerItem,
} from '@repo-radar/core'
import { auth } from '@/auth'
import { getPool } from '@/lib/db'
import { resolveRepoAccess, sessionUser } from '@/lib/session'
import { CopyIntegrationButton } from '@/app/(app)/workbench/integrations/copy-button'
import { markFeedItemDoneAction } from '@/app/(app)/feed/actions'
import { enqueueIssuePlanAction, enqueueMaintainerAction, enqueueUpgradeAction } from '@/app/(app)/jobs/enqueue'
import { signInGithubRepoAction } from '@/app/actions'
import { GenerateMaintainerButton } from './generate-button'

export const dynamic = 'force-dynamic'

const PRIORITIES: Array<{ value: MaintainerItem['priority']; label: string }> = [
  { value: 'now', label: '现在处理' },
  { value: 'week', label: '本周处理' },
  { value: 'later', label: '稍后处理' },
]

const RISK_LABEL: Record<string, string> = {
  major: '大版本',
  minor: '小版本',
  patch: '补丁',
  unknown: '未知',
}

interface MaintainPageProps {
  searchParams: Promise<{ error?: string; report?: string }>
}

export default async function MaintainPage({ searchParams }: MaintainPageProps) {
  const params = await searchParams
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')

  const pool = getPool()
  const requestedReport = Number(params.report)
  const [projects, latestReport, access, handled] = await Promise.all([
    listUserProjects(pool, Number(currentUser.id)),
    findLatestMaintainerReport(pool, Number(currentUser.id)),
    resolveRepoAccess(session, currentUser.login),
    loadHandledState(pool, Number(currentUser.id)),
  ])
  const selectedReport =
    Number.isFinite(requestedReport) && requestedReport > 0
      ? await findMaintainerReportById(pool, Number(currentUser.id), requestedReport)
      : null
  const latest = selectedReport ?? latestReport
  const statusKeys = handled.done
  const returnTo = selectedReport ? `/workbench/maintain?report=${params.report}` : '/workbench/maintain'
  const activeProjects = projects.filter((project) => project.active)
  const briefMeta = latest
    ? { generatedAt: new Date(latest.generatedAt).toLocaleString('zh-CN'), warnings: latest.warnings }
    : null
  const filteredReport = latest ? filterMaintainerReport(latest.report, handled) : null
  const allBrief =
    latest && briefMeta && filteredReport ? buildMaintainerBrief(filteredReport, briefMeta) : ''

  return (
    <div className="page">
      <section className="feed-head">
        <div>
          <p className="eyebrow">维护工作台</p>
          <h1>这周先处理什么</h1>
          <p className="feed-meta">
            把维护中项目的健康度、依赖升级和 Issue/PR 待办合成一张周报，并生成可直接交给代码 AI 的任务书。
          </p>
        </div>
        <div className="feed-actions">
          <Link className="btn quiet small" href="/workbench/maintain/similar">
            相似项目对比
          </Link>
          <Link className="btn small" href="/library?tab=history&kind=maintainer">
            历史生成
          </Link>
          <form action={enqueueMaintainerAction}>
            <GenerateMaintainerButton />
          </form>
        </div>
      </section>

      {params.error === 'no-projects' ? (
        <div className="notice">还没有可分析的项目。先在接入页添加或同步 GitHub 画像。</div>
      ) : null}
      {params.error === 'need-token' ? (
        <div className="notice">生成维护周报需要 GitHub 授权，请重新登录后再试。</div>
      ) : null}
      {params.error === 'env-mismatch' ? (
        <div className="notice">GITHUB_TOKEN 与当前登录账户不一致，无法读取你的仓库数据。</div>
      ) : null}
      {params.error === 'generate' ? <div className="notice">生成失败，请检查模型配置或稍后重试。</div> : null}
      {params.error === 'format' ? (
        <div className="notice">模型返回的内容不是合法 JSON，已自动重试；仍然失败请换一个模型再试。</div>
      ) : null}
      {params.error === 'issue-invalid' ? <div className="notice">Issue 参数不正确。</div> : null}
      {params.error === 'issue-not-found' ? <div className="notice">没有找到这个 Issue。</div> : null}
      {params.error === 'issue-generate' ? <div className="notice">生成修复方案失败，请稍后重试。</div> : null}
      {params.error === 'issue-format' ? <div className="notice">修复方案格式异常，已自动重试；仍然失败请换一个模型。</div> : null}
      {!access.access && activeProjects.length > 0 ? (
        <div className="notice">
          {access.reason === 'need-repo-scope'
            ? '当前登录只有基础权限。读取 Issue/PR、私有仓库和生成维护周报需要 repo 授权；只有删除仓库才需要额外的 delete_repo。'
            : '当前没有可用的 GitHub token，无法读取 Issue/PR 和依赖清单。请重新授权 GitHub 后再生成。'}
          <form action={signInGithubRepoAction} className="inline-action">
            <input type="hidden" name="redirectTo" value="/workbench/maintain" />
            <button className="btn small" type="submit">
              授权仓库管理
            </button>
          </form>
        </div>
      ) : null}

      {latest ? (
        <>
          <div className="integration-report-bar">
            <p className="integration-auto">
              最近生成：{new Date(latest.generatedAt).toLocaleString('zh-CN')} · 项目：
              {latest.usedProjects.join('、')}
              {latest.model ? ` · ${latest.model}` : ''}
              {selectedReport ? ' · 历史版本' : ''}
            </p>
            <CopyIntegrationButton text={allBrief} label="复制周报给 AI" className="btn small" />
          </div>
          {latest.warnings.length > 0 ? (
            <p className="muted small maintain-warnings">数据提示：{latest.warnings.join('；')}</p>
          ) : null}
          <p className="muted small integration-copy-hint">
            复制后粘贴给 Claude Code、Cursor 等代码 AI；任务书要求它先核实、只改目标项目，并且不会自动发布或强推 main。
          </p>

          {latest.report.projects.map((project) => {
            const projectReturnTo = `${returnTo}#project-${project.repo.replace(/[^a-zA-Z0-9_-]/g, '-')}`
            const filteredProject =
              filteredReport?.projects.find((item) => item.repo === project.repo) ?? null
            const projectBrief = filteredProject
              ? buildMaintainerBrief({ projects: [filteredProject] }, briefMeta ?? {})
              : ''
            const pendingWork = filteredProject
              ? filteredProject.items.length + filteredProject.dependencies.length
              : 0
            return (
              <article
                className="integration-card maintain-card"
                id={`project-${project.repo.replace(/[^a-zA-Z0-9_-]/g, '-')}`}
                key={project.repo}
              >
                <header className="integration-head">
                  <Link className="repo-name" href={`/r/${project.repo}`}>
                    {project.repo}
                  </Link>
                  <div className="integration-head-actions">
                    <span
                      className={
                        project.healthScore >= 80
                          ? 'chip verified'
                          : project.healthScore >= 60
                            ? 'chip'
                            : 'chip release'
                      }
                    >
                      健康分 {project.healthScore}
                    </span>
                    <Link
                      className="btn quiet small"
                      href={`/workbench/maintain/similar?repo=${encodeURIComponent(project.repo)}`}
                    >
                      相似项目对比
                    </Link>
                    {projectBrief && pendingWork > 0 ? (
                      <CopyIntegrationButton
                        text={projectBrief}
                        label={`复制给 AI（${pendingWork} 项待处理）`}
                      />
                    ) : (
                      <span className="chip verified">没有待处理项</span>
                    )}
                  </div>
                </header>
                <p className="muted">{project.summary}</p>

                <div className="maintain-columns">
                  {project.strengths.length > 0 ? (
                    <div>
                      <h3 className="maintain-subhead">做得好的地方</h3>
                      <ul className="maintain-list">
                        {project.strengths.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {project.risks.length > 0 ? (
                    <div>
                      <h3 className="maintain-subhead">风险</h3>
                      <ul className="maintain-list">
                        {project.risks.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>

                {project.actions.length > 0 ? (
                  <section className="maintain-section">
                    <h3 className="maintain-subhead">本周建议动作</h3>
                    <ol className="maintain-actions">
                      {project.actions.map((action) => (
                        <li key={action}>{action}</li>
                      ))}
                    </ol>
                  </section>
                ) : null}

                {project.dependencies.length > 0 ? (
                  <section className="maintain-section">
                    <details
                      className="collapsible-section"
                      open={project.dependencies.length <= 3}
                    >
                      <summary className="collapsible-summary">
                        <h3 className="maintain-subhead">依赖升级</h3>
                        <span className="muted small">{project.dependencies.length} 项</span>
                      </summary>
                    <ul className="dependency-list">
                      {project.dependencies.map((dependency) => (
                        <li key={dependency.name}>
                          <div className="dependency-head">
                            <code>{dependency.name}</code>
                            <span className="muted small">
                              {dependency.current ?? '未知'} → {dependency.latest ?? '未知'}
                            </span>
                            <span className={dependency.risk === 'major' ? 'chip release' : 'chip subtle'}>
                              {RISK_LABEL[dependency.risk] ?? dependency.risk}
                            </span>
                            {dependency.vulnerabilities.length > 0 ? (
                              <span className="chip release">安全公告 {dependency.vulnerabilities.length}</span>
                            ) : null}
                            {statusKeys.has(
                              `dependency:${project.repo}:${dependency.name}:${dependency.latest ?? 'unknown'}`.toLowerCase(),
                            ) ? (
                              <span className="chip verified">已完成</span>
                            ) : (
                              <>
                                {handled.dismissed.has(
                                  `dependency:${project.repo}:${dependency.name}:${dependency.latest ?? 'unknown'}`.toLowerCase(),
                                ) ? (
                                  <span className="chip subtle">已忽略</span>
                                ) : null}
                                {dependency.latest ? (
                                  <form action={enqueueUpgradeAction} className="inline-form">
                                    <input type="hidden" name="repo" value={project.repo} />
                                    <input type="hidden" name="package" value={dependency.name} />
                                    <input type="hidden" name="current" value={dependency.current ?? ''} />
                                    <input type="hidden" name="version" value={dependency.latest} />
                                    <button className="btn quiet small" type="submit">
                                      生成升级补丁
                                    </button>
                                  </form>
                                ) : null}
                                <form action={markFeedItemDoneAction} className="inline-form">
                                  <input
                                    type="hidden"
                                    name="itemKey"
                                    value={`dependency:${project.repo}:${dependency.name}:${dependency.latest ?? 'unknown'}`}
                                  />
                                  <input type="hidden" name="kind" value="dependency" />
                                  <input type="hidden" name="returnTo" value={projectReturnTo} />
                                  <button className="btn quiet small" type="submit">
                                    标记完成
                                  </button>
                                </form>
                              </>
                            )}
                          </div>
                          <p className="muted small">{dependency.reason}</p>
                          {dependency.vulnerabilities.length > 0 ? (
                            <p className="muted small">
                              安全公告：{dependency.vulnerabilities.join('、')}
                            </p>
                          ) : null}
                          {dependency.steps.length > 0 ? (
                            <ol className="suggestion-steps">
                              {dependency.steps.map((step) => (
                                <li key={step}>{step}</li>
                              ))}
                            </ol>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                    </details>
                  </section>
                ) : null}

                {project.items.length > 0 ? (
                  <section className="maintain-section">
                    <details
                      className="collapsible-section"
                      open={project.items.length <= 3}
                    >
                      <summary className="collapsible-summary">
                        <h3 className="maintain-subhead">Issue / PR 待办</h3>
                        <span className="muted small">{project.items.length} 项</span>
                      </summary>
                    {PRIORITIES.map((priority) => {
                      const items = project.items.filter((item) => item.priority === priority.value)
                      if (items.length === 0) return null
                      return (
                        <div className="triage-group" key={priority.value}>
                          <span className={priority.value === 'now' ? 'chip release' : 'chip subtle'}>
                            {priority.label}
                          </span>
                          <ul className="triage-list">
                            {items.map((item) => (
                              <li key={`${item.kind}-${item.number}`}>
                                <div className="triage-head">
                                  <a
                                    href={`https://github.com/${project.repo}/${item.kind === 'pull' ? 'pull' : 'issues'}/${item.number}`}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {item.kind === 'pull' ? 'PR' : 'Issue'} #{item.number}
                                  </a>
                                  <span>{item.title}</span>
                                </div>
                                <p className="muted small">{item.reason}</p>
                                <p className="muted small">建议：{item.action}</p>
                                {item.draft ? (
                                  <blockquote className="triage-draft">{item.draft}</blockquote>
                                ) : null}
                                <div className="triage-actions">
                                  {statusKeys.has(
                                    `maintainer:${project.repo}:${item.kind}:${item.number}`.toLowerCase(),
                                  ) ? (
                                    <span className="chip verified">已完成</span>
                                  ) : (
                                    <>
                                    {handled.dismissed.has(
                                      `maintainer:${project.repo}:${item.kind}:${item.number}`.toLowerCase(),
                                    ) ? (
                                      <span className="chip subtle">已忽略</span>
                                    ) : null}
                                    <form action={markFeedItemDoneAction} className="triage-action">
                                      <input
                                        type="hidden"
                                        name="itemKey"
                                        value={`maintainer:${project.repo}:${item.kind}:${item.number}`}
                                      />
                                      <input type="hidden" name="kind" value="maintainer" />
                                      <input type="hidden" name="returnTo" value={projectReturnTo} />
                                      <button className="btn quiet small" type="submit">
                                        标记完成
                                      </button>
                                    </form>
                                    </>
                                  )}
                                  {item.kind === 'issue' &&
                                  !statusKeys.has(`maintainer:${project.repo}:${item.kind}:${item.number}`.toLowerCase()) ? (
                                    <form action={enqueueIssuePlanAction} className="triage-action">
                                      <input type="hidden" name="repo" value={project.repo} />
                                      <input type="hidden" name="number" value={item.number} />
                                      <button className="btn quiet small" type="submit">
                                        生成修复方案
                                      </button>
                                    </form>
                                  ) : null}
                                </div>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )
                    })}
                    </details>
                  </section>
                ) : null}
              </article>
            )
          })}
        </>
      ) : (
        <div className="empty">
          <p>还没有生成过维护周报。</p>
          <p className="small">
            {activeProjects.length > 0
              ? `已选中 ${activeProjects.length} 个维护中的项目，点击右上角生成。`
              : '先在接入页标记维护中的项目，或同步 GitHub 画像。'}
          </p>
        </div>
      )}
    </div>
  )
}
