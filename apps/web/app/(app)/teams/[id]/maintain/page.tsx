import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  TEAM_ROLE_LABEL,
  findTeamForUser,
  listTeamProjectShares,
  getPool,
} from '@repo-radar/core'
import { auth } from '@/auth'
import { sessionUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

interface TeamMaintainPageProps {
  params: Promise<{ id: string }>
}

const RISK_LABEL: Record<string, string> = {
  major: '大版本',
  minor: '小版本',
  patch: '补丁',
  unknown: '未知',
}

const PRIORITY_LABEL: Record<string, string> = {
  now: '现在',
  week: '本周',
  later: '稍后',
}

export default async function TeamMaintainPage({ params }: TeamMaintainPageProps) {
  const { id } = await params
  const teamId = Number(id)
  if (!Number.isFinite(teamId) || teamId <= 0) notFound()

  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')

  const team = await findTeamForUser(getPool(), Number(currentUser.id), teamId)
  if (!team) notFound()

  const projects = await listTeamProjectShares(getPool(), teamId)
  const withReport = projects.filter((project) => project.report)
  const riskTotal = withReport.reduce((sum, project) => sum + (project.report?.riskCount ?? 0), 0)
  const itemTotal = withReport.reduce((sum, project) => sum + (project.report?.itemCount ?? 0), 0)

  return (
    <div className="page">
      <p className="breadcrumb">
        <Link href={`/teams?team=${team.id}`}>← 返回团队</Link>
      </p>

      <section className="feed-head">
        <div>
          <p className="eyebrow">团队维护汇总</p>
          <h1>{team.name}</h1>
          <p className="feed-meta">
            你的角色：{TEAM_ROLE_LABEL[team.role]} · {projects.length} 个共享项目 · {withReport.length} 个有报告
          </p>
        </div>
        <div className="feed-actions">
          <Link className="btn small" href="/workbench/maintain">
            生成我的维护周报
          </Link>
          <Link className="btn quiet small" href={`/teams?team=${team.id}`}>
            管理团队
          </Link>
        </div>
      </section>

      <div className="library-stat-grid dependency-stat-grid">
        <div className="library-stat">
          <span>{projects.length}</span>
          <small>共享项目</small>
        </div>
        <div className="library-stat">
          <span>{withReport.length}</span>
          <small>有维护报告</small>
        </div>
        <div className="library-stat">
          <span>{riskTotal}</span>
          <small>依赖风险</small>
        </div>
        <div className="library-stat">
          <span>{itemTotal}</span>
          <small>Issue / PR 待办</small>
        </div>
      </div>

      {projects.length === 0 ? (
        <div className="empty">
          <p>团队还没有共享维护项目。</p>
          <p className="small">
            回到 <Link href={`/teams?team=${team.id}`}>团队页</Link> 共享一个 `owner/repo`。
          </p>
        </div>
      ) : (
        <div className="team-maintain-grid">
          {projects.map((project) => (
            <section className="panel team-maintain-card" key={project.projectFullName}>
              <header className="team-maintain-head">
                <div>
                  <h2>
                    <Link href={`/r/${project.projectFullName}`}>{project.projectFullName}</Link>
                  </h2>
                  <p className="muted small">
                    由 {project.sharedBy} 共享
                    {project.report
                      ? ` · ${project.report.reporter} 生成于 ${new Date(project.report.generatedAt).toLocaleString('zh-CN')}`
                      : ' · 还没有维护报告'}
                  </p>
                </div>
                {project.report ? (
                  <span className={project.report.healthScore >= 70 ? 'chip verified' : 'chip release'}>
                    健康 {project.report.healthScore}
                  </span>
                ) : null}
              </header>

              {project.report ? (
                <>
                  <p className="muted">{project.report.summary}</p>

                  {project.report.dependencies.length > 0 ? (
                    <details className="collapsible-section" open={project.report.dependencies.length <= 4}>
                      <summary className="collapsible-summary">
                        <span>依赖风险</span>
                        <span className="muted small">{project.report.dependencies.length} 项</span>
                      </summary>
                      <ul className="maintain-list">
                        {project.report.dependencies.map((dependency) => (
                          <li key={dependency.name}>
                            <strong>{dependency.name}</strong>{' '}
                            <span className="chip subtle">{RISK_LABEL[dependency.risk] ?? dependency.risk}</span>{' '}
                            <span className="muted small">
                              {dependency.current ?? '未知'} → {dependency.latest ?? '未知'}
                            </span>
                            {dependency.vulnerabilities.length > 0 ? (
                              <span className="job-error"> · 安全公告 {dependency.vulnerabilities.length}</span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}

                  {project.report.items.length > 0 ? (
                    <details className="collapsible-section" open={project.report.items.length <= 4}>
                      <summary className="collapsible-summary">
                        <span>Issue / PR 待办</span>
                        <span className="muted small">{project.report.items.length} 项</span>
                      </summary>
                      <ul className="maintain-list">
                        {project.report.items.map((item) => (
                          <li key={`${item.kind}-${item.number}`}>
                            <span className="chip subtle">{PRIORITY_LABEL[item.priority] ?? item.priority}</span>{' '}
                            <span className="muted small">{item.kind === 'pull' ? 'PR' : 'Issue'} #{item.number}</span>{' '}
                            {item.title}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}

                  {project.report.actions.length > 0 ? (
                    <details className="collapsible-section" open={project.report.actions.length <= 3}>
                      <summary className="collapsible-summary">本周建议动作</summary>
                      <ol className="maintain-actions">
                        {project.report.actions.map((action) => (
                          <li key={action}>{action}</li>
                        ))}
                      </ol>
                    </details>
                  ) : null}
                </>
              ) : (
                <p className="muted small">
                  团队里还没有成员为这个项目生成维护周报。去{' '}
                  <Link href="/workbench/maintain">维护工作台</Link> 生成一次即可汇总到这里。
                </p>
              )}

              <div className="feed-actions">
                <Link className="btn quiet small" href={`/evidence/${project.projectFullName}`}>
                  验证证据
                </Link>
                <a
                  className="btn quiet small"
                  href={`https://github.com/${project.projectFullName}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  GitHub
                </a>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
