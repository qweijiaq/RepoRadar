import Link from 'next/link'
import { redirect } from 'next/navigation'
import { GitHubManageError, listOwnedRepos, type ManagedRepo } from '@repo-radar/core'
import { signInGithubAction } from '@/app/actions'
import { auth } from '@/auth'
import { resolveRepoAccess, sessionUser } from '@/lib/session'
import { RepoManager } from './repo-manager'

export const dynamic = 'force-dynamic'

export default async function ReposPage() {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')

  const resolved = await resolveRepoAccess(session, currentUser.login)
  const access = resolved.access
  let repos: ManagedRepo[] = []
  let errorMessage: string | null = null
  let needsReauth = false

  if (access) {
    try {
      repos = await listOwnedRepos(access.token)
    } catch (error) {
      if (error instanceof GitHubManageError) {
        needsReauth = error.needsReauth
        errorMessage = error.message
      } else {
        errorMessage = error instanceof Error ? error.message : '读取仓库失败'
      }
    }
  }

  return (
    <div className="page">
      <section className="feed-head">
        <div>
          <p className="eyebrow">仓库管理</p>
          <h1>管理你的 GitHub 仓库</h1>
          <p className="feed-meta">
            批量新建、修改描述 / 可见性 / 归档状态，或删除仓库。删除不可恢复，需要额外的 delete_repo 授权。
          </p>
        </div>
      </section>

      {resolved.reason === 'env-mismatch' ? (
        <div className="notice">
          当前 GITHUB_TOKEN 与登录账户 {currentUser.login} 不一致，仓库管理已停用。请用该 token
          所属账户登录，或改用 OAuth 授权。
        </div>
      ) : !access ? (
        <div className="empty">
          <p>需要 GitHub 登录授权才能读取和管理你的仓库。</p>
          <p className="small">授权范围包含 repo 与 delete_repo；如果还没配置 OAuth 应用，先去设置页完成配置。</p>
          <form action={signInGithubAction}>
            <input type="hidden" name="redirectTo" value="/repos" />
            <button className="btn solid" type="submit">
              使用 GitHub 登录
            </button>
          </form>
          <p className="small">
            或前往 <Link href="/setup">OAuth 配置说明</Link>。
          </p>
        </div>
      ) : needsReauth ? (
        <div className="notice">
          当前 GitHub 授权范围不足（需要 <code>repo</code> 与 <code>delete_repo</code>
          ）。重新授权后即可读取私有仓库并执行删除。{errorMessage ? `（${errorMessage}）` : ''}
          <form action={signInGithubAction} className="inline-action">
            <input type="hidden" name="redirectTo" value="/repos" />
            <button className="btn small" type="submit">
              重新授权 GitHub
            </button>
          </form>
        </div>
      ) : errorMessage ? (
        <div className="notice">读取 GitHub 仓库失败：{errorMessage}</div>
      ) : (
        <>
          {access.source === 'env' ? (
            <p className="integration-auto">当前使用环境变量 GITHUB_TOKEN 操作，页面登录账户仅用于身份识别。</p>
          ) : null}
          <RepoManager initialRepos={repos} />
        </>
      )}
    </div>
  )
}
