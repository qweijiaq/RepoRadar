import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  findLatestMaintainerReport,
  listIntegrationImpacts,
  listUserProjects,
  getPool,
} from '@repo-radar/core'
import { auth } from '@/auth'
import { sessionUser } from '@/lib/session'

export const dynamic = 'force-dynamic'
export const metadata = { title: '依赖与安全 — RepoRadar' }

const RISK_LABEL: Record<string, string> = {
  major: '大版本',
  minor: '小版本',
  patch: '补丁',
  unknown: '未知',
}

function riskClass(risk: string): string {
  if (risk === 'major') return 'chip release'
  if (risk === 'minor') return 'chip subtle'
  return 'chip'
}

interface DependencyRow {
  project: string
  name: string
  current: string | null
  latest: string | null
  risk: string
  reason: string
  steps: string[]
  vulnerabilities: string[]
}

export default async function DependenciesPage() {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')

  const pool = getPool()
  const userId = Number(currentUser.id)
  const [report, projects, impacts] = await Promise.all([
    findLatestMaintainerReport(pool, userId),
    listUserProjects(pool, userId),
    listIntegrationImpacts(pool, userId, 20),
  ])

  const rows: DependencyRow[] =
    report?.report.projects.flatMap((project) =>
      project.dependencies.map((dependency) => ({
        project: project.repo,
        name: dependency.name,
        current: dependency.current,
        latest: dependency.latest,
        risk: dependency.risk,
        reason: dependency.reason,
        steps: dependency.steps,
        vulnerabilities: dependency.vulnerabilities,
      })),
    ) ?? []

  const major = rows.filter((row) => row.risk === 'major').length
  const advisories = rows.filter((row) => row.vulnerabilities.length > 0).length
  const activeProjects = projects.filter((project) => project.active).length

  return (
    <div className="page narrow">
      <p className="breadcrumb">
        <Link href="/workbench/maintain">← 返回维护周报</Link>
      </p>

      <section className="feed-head">
        <div>
          <p className="eyebrow">依赖与安全</p>
          <h1>哪些依赖需要先处理</h1>
          <p className="feed-meta">
            汇总最近一次维护周报里的依赖风险、安全公告和已接入库的版本回访。数据来自 lockfile、npm / PyPI / Go /
            crates.io 和 OSV。
          </p>
        </div>
        <div className="feed-actions">
          <Link className="btn quiet small" href="/library?tab=history&kind=maintainer">
            历史周报
          </Link>
          <Link className="btn small" href="/workbench/integrations">
            接入回访
          </Link>
        </div>
      </section>

      {!report ? (
        <div className="empty">
          <p>还没有维护周报，所以暂时没有依赖数据。</p>
          <p className="small">
            回到 <Link href="/workbench/maintain">维护周报</Link> 生成一次，依赖升级和安全公告会出现在这里。
          </p>
        </div>
      ) : (
        <>
          <div className="library-stat-grid dependency-stat-grid">
            <div className="library-stat">
              <span>{activeProjects}</span>
              <small>维护中项目</small>
            </div>
            <div className="library-stat">
              <span>{rows.length}</span>
              <small>依赖项</small>
            </div>
            <div className="library-stat">
              <span>{major}</span>
              <small>大版本风险</small>
            </div>
            <div className="library-stat">
              <span>{advisories}</span>
              <small>含安全公告</small>
            </div>
            <div className="library-stat">
              <span>{impacts.length}</span>
              <small>版本回访</small>
            </div>
          </div>

          <p className="muted small">
            数据来自 {new Date(report.generatedAt).toLocaleString('zh-CN')}
            {report.model ? ` · ${report.model}` : ''}
            {report.usedProjects.length > 0 ? ` · ${report.usedProjects.join('、')}` : ''}
          </p>

          {rows.length === 0 ? (
            <div className="empty">
              <p>最近一次周报没有发现需要升级的依赖。</p>
              <p className="small">可以点上方「历史周报」回看之前的报告，或重新生成维护周报。</p>
            </div>
          ) : (
            <section className="panel">
              <h2>依赖风险</h2>
              <ul className="dependency-list">
                {rows.map((row) => (
                  <li className="dependency-row" key={`${row.project}:${row.name}`}>
                    <div className="dependency-head">
                      <span className="repo-name">{row.name}</span>
                      <span className={riskClass(row.risk)}>{RISK_LABEL[row.risk] ?? row.risk}</span>
                      {row.vulnerabilities.length > 0 ? (
                        <span className="chip release">安全公告 {row.vulnerabilities.length}</span>
                      ) : null}
                      <span className="muted small">{row.project}</span>
                    </div>
                    <p className="muted small">
                      {row.current ?? '未知'} → {row.latest ?? '未知'}
                    </p>
                    <p>{row.reason}</p>
                    {row.vulnerabilities.length > 0 ? (
                      <p className="job-error">安全公告：{row.vulnerabilities.join('、')}</p>
                    ) : null}
                    {row.steps.length > 0 ? (
                      <details className="score-detail">
                        <summary>升级步骤</summary>
                        <ol className="maintain-actions">
                          {row.steps.map((step) => (
                            <li key={step}>{step}</li>
                          ))}
                        </ol>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="panel">
            <h2>接入库回访</h2>
            {impacts.length === 0 ? (
              <p className="muted small">
                标记「已接入」的库发布新版本或安全公告后，这里会记录回访。
              </p>
            ) : (
              <ul className="timeline">
                {impacts.map((impact) => (
                  <li key={impact.id}>
                    <span className="timeline-date">
                      {new Date(impact.createdAt).toLocaleDateString('zh-CN')}
                    </span>
                    <span className="chip subtle">
                      {impact.kind === 'advisory' ? '安全公告' : '新版本'}
                    </span>{' '}
                    <strong>{impact.suggestionRepo}</strong>{' '}
                    <span className="muted small">
                      {impact.version} · {impact.projectFullName}
                    </span>
                    {impact.url ? (
                      <>
                        {' '}
                        <a href={impact.url} target="_blank" rel="noreferrer">
                          查看
                        </a>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}
