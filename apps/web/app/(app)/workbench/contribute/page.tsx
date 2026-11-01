import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  findEnrichedRepos,
  findRepoByFullName,
  findSimilarRepos,
  getPool,
  isFriendlyIssue,
  listOpenIssues,
  listUserProjects,
  rankContributionTargets,
} from '@repo-radar/core'
import { auth } from '@/auth'
import { resolveGithubToken, sessionUser } from '@/lib/session'

export const dynamic = 'force-dynamic'
export const metadata = { title: '贡献雷达 — RepoRadar' }

export default async function ContributePage() {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')

  const pool = getPool()
  const userId = Number(currentUser.id)
  const projects = (await listUserProjects(pool, userId))
    .filter((project) => project.active)
    .slice(0, 3)
  const token = resolveGithubToken(session)?.token ?? null

  const allRepos = await findEnrichedRepos(pool, 500)
  const targets = await Promise.all(
    projects.map((project) => findRepoByFullName(pool, project.repoFullName)),
  )
  const entries = targets.flatMap((target, index) => {
    if (!target) return []
    const project = projects[index]
    if (!project) return []
    return findSimilarRepos(target, allRepos, 5).map((item) => ({
      repo: item.repo,
      similarity: item.similarity,
      project: project.repoFullName,
    }))
  })
  const top = rankContributionTargets(entries, 8)

  const issueLists = token
    ? await Promise.all(
        top.map((item) =>
          listOpenIssues(item.repo.fullName, { token, limit: 20 }).catch(() => []),
        ),
      )
    : []
  const rows = top
    .map((item, index) => ({
      ...item,
      issues: (issueLists[index] ?? []).filter(isFriendlyIssue).slice(0, 3),
    }))
    .filter((row) => row.issues.length > 0)

  return (
    <div className="page">
      <section className="feed-head">
        <div>
          <p className="eyebrow">贡献雷达</p>
          <h1>用你熟悉的栈，给相似项目补一块</h1>
          <p className="feed-meta">
            根据你维护的项目找技术栈相近的仓库，再筛出标记为 good first issue / help wanted 的开放 Issue。
            点「生成修复方案」会进入现有的 Issue 方案流程，补丁仍然需要人工审阅。
          </p>
        </div>
      </section>

      {projects.length === 0 ? (
        <div className="notice">
          还没有标记为「维护中」的项目。先到设置页同步 GitHub，或在接入页添加项目。
        </div>
      ) : null}
      {projects.length > 0 && !token ? (
        <div className="notice">需要 GitHub 授权才能读取 Issue，请重新登录后再试。</div>
      ) : null}

      {rows.length > 0 ? (
        <section className="panel">
          <h2>可以贡献的项目</h2>
          <ul className="maintain-list">
            {rows.map((row) => (
              <li key={row.repo.fullName}>
                <Link href={`/r/${row.repo.fullName}`}>{row.repo.fullName}</Link>{' '}
                <span className="chip subtle">{Math.round(row.similarity * 100)}% 相似</span>{' '}
                <span className="muted small">与 {row.project} 相关</span>
                <ul className="maintain-list">
                  {row.issues.map((issue) => (
                    <li key={issue.number}>
                      <a href={issue.url} target="_blank" rel="noreferrer">
                        #{issue.number} {issue.title}
                      </a>{' '}
                      <Link href={`/issue-plan?repo=${row.repo.fullName}&number=${issue.number}`}>
                        生成修复方案
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      ) : projects.length > 0 && token ? (
        <section className="panel">
          <p className="muted">
            暂时没有找到合适的贡献机会。可以在设置页补充更多 star/项目，或换一个维护中的项目再试。
          </p>
        </section>
      ) : null}
    </div>
  )
}
