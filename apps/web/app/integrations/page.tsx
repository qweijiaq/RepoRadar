import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  buildIntegrationBrief,
  buildProjectIntegrationBrief,
  findIntegrationReportById,
  findLatestIntegrationReport,
  listIntegrationOutcomes,
  listUserProjects,
} from '@repo-radar/core'
import {
  addUserProjectAction,
  removeUserProjectAction,
  setIntegrationOutcomeAction,
  toggleProjectActiveAction,
} from '@/app/actions'
import { enqueueComparisonAction, enqueueIntegrationAction } from '@/app/jobs/enqueue'
import { auth } from '@/auth'
import { getPool } from '@/lib/db'
import { sessionUser } from '@/lib/session'
import { CopyIntegrationButton } from './copy-button'
import { GenerateIntegrationButton } from './generate-button'

export const dynamic = 'force-dynamic'

interface IntegrationsPageProps {
  searchParams: Promise<{ error?: string; report?: string }>
}

export default async function IntegrationsPage({ searchParams }: IntegrationsPageProps) {
  const params = await searchParams
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')

  const pool = getPool()
  const requestedReport = Number(params.report)
  const [projects, latestReport, outcomes, selectedReport] = await Promise.all([
    listUserProjects(pool, Number(currentUser.id)),
    findLatestIntegrationReport(pool, Number(currentUser.id)),
    listIntegrationOutcomes(pool, Number(currentUser.id)),
    Number.isFinite(requestedReport) && requestedReport > 0
      ? findIntegrationReportById(pool, Number(currentUser.id), requestedReport)
      : Promise.resolve(null),
  ])
  const latest = selectedReport ?? latestReport
  const outcomeMap = new Map(
    outcomes.map((outcome) => [`${outcome.projectFullName}|${outcome.suggestionRepo}`, outcome.status]),
  )
  const activeProjects = projects.filter((project) => project.active)
  const briefMeta = latest
    ? {
        generatedAt: new Date(latest.generatedAt).toLocaleString('zh-CN'),
        focus: latest.focus,
        usedProjects: latest.usedProjects,
        auto: latest.auto,
      }
    : null
  const allBrief = latest && briefMeta ? buildIntegrationBrief(latest.report.projects, briefMeta) : ''

  return (
    <div className="page">
      <section className="feed-head">
        <div>
          <p className="eyebrow">接入建议</p>
          <h1>给你的项目做补位</h1>
          <p className="feed-meta">
            以你正在维护的项目为起点，找「当前没有、可以接入」或「已有、可以优化」的开源项目。
          </p>
        </div>
        <div className="feed-actions">
          <Link className="btn small" href="/history?kind=integration">
            历史生成
          </Link>
          <form action={enqueueIntegrationAction} className="integration-generate">
            <input
              className="input"
              name="focus"
              placeholder="可选：想补什么能力？例如鉴权、可观测性"
              maxLength={200}
            />
            <GenerateIntegrationButton />
          </form>
        </div>
      </section>

      {params.error === 'no-projects' ? (
        <div className="notice">还没有可用的项目。先在下面添加一个，或去设置页同步 GitHub 画像。</div>
      ) : null}
      {params.error === 'need-token' ? (
        <div className="notice">添加新项目需要 GitHub 登录授权，请重新登录后再试。</div>
      ) : null}
      {params.error === 'not-found' ? <div className="notice">没有找到这个仓库。</div> : null}
      {params.error === 'invalid' ? <div className="notice">仓库格式应为 owner/name。</div> : null}
      {params.error === 'generate' ? <div className="notice">生成失败，请检查模型配置或稍后重试。</div> : null}
      {params.error === 'format' ? (
        <div className="notice">
          模型调用成功，但返回的内容不是合法 JSON（常见于输出被截断）。系统已自动重试；仍然失败时请换一个模型，或把「本轮关注」写得更具体后重试。
        </div>
      ) : null}
      {params.error === 'compare-candidates' ? (
        <div className="notice">对比至少需要 2 个候选，这份报告里的建议不够。</div>
      ) : null}
      {params.error === 'compare-token' ? (
        <div className="notice">生成对比需要 GitHub 授权，请重新登录后再试。</div>
      ) : null}
      {params.error === 'compare' || params.error === 'compare-format' ? (
        <div className="notice">
          对比生成失败{params.error === 'compare-format' ? '：模型返回格式异常，已自动重试' : ''}，请稍后再试。
        </div>
      ) : null}

      <section className="panel" id="projects">
        <h2>正在维护的项目</h2>
        <p className="muted small">
          标记为「维护中」的项目会参与接入建议。没有标记时，AI 会根据最近推送的仓库自动选择。
        </p>

        {projects.length > 0 ? (
          <ul className="project-list">
            {projects.map((project) => (
              <li className={project.active ? 'project-row active' : 'project-row'} key={project.repoFullName}>
                <div className="project-main">
                  <Link className="repo-name" href={`/r/${project.repoFullName}`}>
                    {project.repoFullName}
                  </Link>
                  <p className="muted small">
                    {project.description ?? '暂无描述'}
                    {project.language ? ` · ${project.language}` : ''}
                  </p>
                  <span className="project-source">
                    {project.source === 'owned' ? '自动同步' : '手动添加'}
                    {project.lastPushedAt
                      ? ` · 最近推送 ${new Date(project.lastPushedAt).toLocaleDateString('zh-CN')}`
                      : ''}
                  </span>
                </div>
                <div className="project-actions">
                  <form action={toggleProjectActiveAction}>
                    <input type="hidden" name="repo" value={project.repoFullName} />
                    <input type="hidden" name="active" value={project.active ? '0' : '1'} />
                    <button type="submit" className={project.active ? 'chip toggle active' : 'chip toggle'}>
                      {project.active ? '维护中' : '未启用'}
                    </button>
                  </form>
                  {project.source === 'manual' ? (
                    <form action={removeUserProjectAction}>
                      <input type="hidden" name="repo" value={project.repoFullName} />
                      <button className="btn quiet small" type="submit">
                        移除
                      </button>
                    </form>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">还没有项目。可以在下面手动添加，或先同步 GitHub 画像。</p>
        )}

        <form action={addUserProjectAction} className="project-add">
          <input className="input" name="repo" placeholder="owner/repo" />
          <button className="btn small" type="submit">
            添加项目
          </button>
        </form>
      </section>

      {latest ? (
        <>
          <div className="integration-report-bar">
            <p className="integration-auto">
              最近生成：{new Date(latest.generatedAt).toLocaleString('zh-CN')}
              {latest.auto ? ` · 未指定项目，AI 自动选择了 ${latest.usedProjects.join('、')}` : ''}
              {latest.focus ? ` · 本轮关注：${latest.focus}` : ''}
              {latest.model ? ` · ${latest.model}` : ''}
              {selectedReport ? ' · 历史版本' : ''}
            </p>
            <CopyIntegrationButton text={allBrief} label="复制全部给 AI" className="btn small" />
          </div>
          <p className="muted small integration-copy-hint">
            复制后粘贴给 Claude Code、Cursor 等代码 AI，它会按任务书核实候选并在目标项目里执行接入。
          </p>
          {latest.candidateRepos?.length ? (
            <details className="trace-details">
              <summary>
                本次候选池 {latest.candidateCount ?? latest.candidateRepos.length} 个
              </summary>
              <div className="chips">
                {latest.candidateRepos.map((repo) => (
                  <span className="chip subtle" key={repo}>
                    {repo}
                  </span>
                ))}
              </div>
            </details>
          ) : null}
          {latest.report.projects.map((project) => {
            const projectBrief = buildProjectIntegrationBrief(project, {
              generatedAt: briefMeta?.generatedAt,
              focus: briefMeta?.focus,
            })
            return (
              <article className="integration-card" key={project.repo}>
                <header className="integration-head">
                  <Link className="repo-name" href={`/r/${project.repo}`}>
                    {project.repo}
                  </Link>
                  <div className="integration-head-actions">
                    <span className="chip subtle">项目</span>
                    {project.suggestions.length >= 2 ? (
                      <form action={enqueueComparisonAction}>
                        <input type="hidden" name="project" value={project.repo} />
                        <button className="btn quiet small" type="submit">
                          对比候选
                        </button>
                      </form>
                    ) : null}
                    <CopyIntegrationButton text={projectBrief} label="复制给 AI" />
                  </div>
                </header>
              <p className="muted">{project.summary}</p>
              {project.gaps.length > 0 ? (
                <div className="chips">
                  {project.gaps.map((gap) => (
                    <span className="chip" key={gap}>
                      {gap}
                    </span>
                  ))}
                </div>
              ) : null}
              {project.suggestions.length > 0 ? (
                <ul className="integration-suggestions">
                  {project.suggestions.map((suggestion) => (
                    <li key={suggestion.repo}>
                      <div className="suggestion-head">
                        <Link href={`/r/${suggestion.repo}`}>{suggestion.repo}</Link>
                        <span className={suggestion.kind === 'missing' ? 'chip release' : 'chip rising'}>
                          {suggestion.kind === 'missing' ? '缺失功能' : '可优化'}
                        </span>
                        <span className="chip subtle">{suggestion.action === 'try' ? '值得接入' : '观望'}</span>
                        {suggestion.alreadyUsed ? <span className="chip used">已在使用</span> : null}
                      </div>
                      <p className="muted small">{suggestion.reason}</p>
                      {suggestion.steps.length > 0 ? (
                        <ol className="suggestion-steps">
                          {suggestion.steps.map((step) => (
                            <li key={step}>{step}</li>
                          ))}
                        </ol>
                      ) : null}
                      {(() => {
                        const outcome = outcomeMap.get(`${project.repo}|${suggestion.repo}`)
                        return (
                          <div className="suggestion-feedback">
                            {outcome === 'adopted' ? <span className="chip verified">已接入</span> : null}
                            {outcome === 'rejected' ? <span className="chip subtle">已忽略</span> : null}
                            <form action={setIntegrationOutcomeAction}>
                              <input type="hidden" name="project" value={project.repo} />
                              <input type="hidden" name="repo" value={suggestion.repo} />
                              <input type="hidden" name="status" value="adopted" />
                              <button className="btn quiet small" type="submit">
                                标记已接入
                              </button>
                            </form>
                            <form action={setIntegrationOutcomeAction}>
                              <input type="hidden" name="project" value={project.repo} />
                              <input type="hidden" name="repo" value={suggestion.repo} />
                              <input type="hidden" name="status" value="rejected" />
                              <button className="btn quiet small" type="submit">
                                不感兴趣
                              </button>
                            </form>
                          </div>
                        )
                      })()}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted small">没有找到合适的候选。</p>
              )}
              </article>
            )
          })}
        </>
      ) : (
        <div className="empty">
          <p>还没有生成过接入建议。</p>
          <p className="small">
            {activeProjects.length > 0
              ? `已选中 ${activeProjects.length} 个维护中的项目，点击右上角生成。`
              : '标记至少一个维护中的项目，或直接点击生成让 AI 根据最近活动自动选择。'}
          </p>
        </div>
      )}
    </div>
  )
}
