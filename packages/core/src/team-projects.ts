import type { DbPool } from './db.js'
import type { StoredMaintainerReport } from './maintainer.js'

export interface TeamSharedProject {
  projectFullName: string
  sharedBy: string
  createdAt: string
  report: {
    reportId: number
    reporter: string
    generatedAt: string
    healthScore: number
    summary: string
    dependencyCount: number
    riskCount: number
    itemCount: number
    dependencies: Array<{
      name: string
      current: string | null
      latest: string | null
      risk: string
      vulnerabilities: string[]
    }>
    items: Array<{
      kind: 'issue' | 'pull'
      number: number
      title: string
      priority: string
    }>
    actions: string[]
  } | null
}

interface ShareRow {
  project_full_name: string
  shared_by: string
  created_at: Date | string
}

interface ReportRow {
  id: string
  login: string
  payload: StoredMaintainerReport
  created_at: Date | string
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value
}

export async function listTeamProjectShares(pool: DbPool, teamId: number): Promise<TeamSharedProject[]> {
  const [shares, reports] = await Promise.all([
    pool.query<ShareRow>(
      `SELECT s.project_full_name, u.login AS shared_by, s.created_at
       FROM team_project_shares s
       JOIN users u ON u.id = s.shared_by_user_id
       WHERE s.team_id = $1
       ORDER BY s.created_at DESC`,
      [teamId],
    ),
    pool.query<ReportRow>(
      `SELECT mr.id, u.login, mr.payload, mr.created_at
       FROM maintainer_reports mr
       JOIN users u ON u.id = mr.user_id
       JOIN team_members tm ON tm.user_id = mr.user_id AND tm.team_id = $1
       ORDER BY mr.created_at DESC
       LIMIT 100`,
      [teamId],
    ),
  ])

  const latest = new Map<
    string,
    {
      reportId: number
      reporter: string
      generatedAt: string
      healthScore: number
      summary: string
      dependencyCount: number
      riskCount: number
      itemCount: number
      dependencies: Array<{
        name: string
        current: string | null
        latest: string | null
        risk: string
        vulnerabilities: string[]
      }>
      items: Array<{
        kind: 'issue' | 'pull'
        number: number
        title: string
        priority: string
      }>
      actions: string[]
    }
  >()

  for (const row of reports.rows) {
    const projects = row.payload?.report?.projects ?? []
    for (const project of projects) {
      const key = project.repo.toLowerCase()
      if (latest.has(key)) continue
      const dependencies = project.dependencies ?? []
      const items = project.items ?? []
      latest.set(key, {
        reportId: Number(row.id),
        reporter: row.login,
        generatedAt: row.payload.generatedAt ?? iso(row.created_at),
        healthScore: project.healthScore,
        summary: project.summary,
        dependencyCount: dependencies.length,
        riskCount: dependencies.filter(
          (dependency) => dependency.risk === 'major' || dependency.risk === 'minor',
        ).length,
        itemCount: items.length,
        dependencies: dependencies.map((dependency) => ({
          name: dependency.name,
          current: dependency.current,
          latest: dependency.latest,
          risk: dependency.risk,
          vulnerabilities: dependency.vulnerabilities ?? [],
        })),
        items: items.map((item) => ({
          kind: item.kind,
          number: item.number,
          title: item.title,
          priority: item.priority,
        })),
        actions: project.actions ?? [],
      })
    }
  }

  return shares.rows.map((row) => ({
    projectFullName: row.project_full_name,
    sharedBy: row.shared_by,
    createdAt: iso(row.created_at),
    report: latest.get(row.project_full_name.toLowerCase()) ?? null,
  }))
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export interface TeamDigest {
  subject: string
  text: string
  html: string
}

export async function buildTeamDigest(
  pool: DbPool,
  teamId: number,
  teamName: string,
  baseUrl: string,
  date = new Date(),
): Promise<TeamDigest | null> {
  const projects = await listTeamProjectShares(pool, teamId)
  const withReport = projects.filter((project) => project.report)
  if (withReport.length === 0) return null

  const site = baseUrl.replace(/\/+$/, '')
  const dateLabel = date.toISOString().slice(0, 10)
  const subject = `[RepoRadar] ${teamName} 团队维护摘要 — ${dateLabel}`

  const textLines = [
    `${teamName} 团队维护摘要`,
    `${dateLabel} · ${projects.length} 个共享项目 · ${withReport.length} 个有维护报告`,
    '',
    ...projects.map((project) => {
      if (!project.report) return `- ${project.projectFullName}：还没有维护报告`
      return `- ${project.projectFullName}：健康 ${project.report.healthScore}，依赖风险 ${project.report.riskCount}，待办 ${project.report.itemCount}（${project.report.reporter}）`
    }),
    '',
    `查看汇总：${site}/teams/${teamId}/maintain`,
  ]

  const htmlRows = projects
    .map((project) => {
      const details = project.report
        ? `健康 ${project.report.healthScore} · 依赖风险 ${project.report.riskCount} · 待办 ${project.report.itemCount}`
        : '还没有维护报告'
      return `<li><strong>${escapeHtml(project.projectFullName)}</strong>：${escapeHtml(details)}${
        project.report ? `（${escapeHtml(project.report.reporter)}）` : ''
      }</li>`
    })
    .join('')

  const html = `<h2>${escapeHtml(teamName)} 团队维护摘要</h2>
<p>${escapeHtml(dateLabel)} · ${projects.length} 个共享项目 · ${withReport.length} 个有维护报告</p>
<ul>${htmlRows}</ul>
<p><a href="${escapeHtml(`${site}/teams/${teamId}/maintain`)}">查看团队维护汇总</a></p>`

  return { subject, text: textLines.join('\n'), html }
}

export async function shareTeamProject(
  pool: DbPool,
  teamId: number,
  projectFullName: string,
  userId: number,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `INSERT INTO team_project_shares (team_id, project_full_name, shared_by_user_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (team_id, project_full_name) DO UPDATE SET
       shared_by_user_id = EXCLUDED.shared_by_user_id,
       created_at = now()`,
    [teamId, projectFullName, userId],
  )
  return (rowCount ?? 0) > 0
}

export async function unshareTeamProject(
  pool: DbPool,
  teamId: number,
  projectFullName: string,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM team_project_shares WHERE team_id = $1 AND project_full_name = $2`,
    [teamId, projectFullName],
  )
  return (rowCount ?? 0) > 0
}
