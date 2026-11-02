import Link from 'next/link'
import { redirect } from 'next/navigation'
import { signInDemoAction, signInDevAction, signInGithubAction } from '@/app/actions'
import { auth } from '@/auth'
import { resolveGithubCredentials } from '@/lib/oauth-config'
import { sessionUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

interface LoginPageProps {
  searchParams: Promise<{ configured?: string; error?: string }>
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams
  const session = await auth()
  if (sessionUser(session)) redirect('/feed')

  const credentials = await resolveGithubCredentials()
  const devMode = process.env.AUTH_DEV_MODE === '1' && process.env.NODE_ENV !== 'production'
  const demoMode = process.env.RADAR_DEMO_MODE === '1'

  return (
    <div className="page">
      <div className="auth-card">
        <p className="eyebrow">登录</p>
        <h1>进入你的雷达</h1>
        <p className="muted">
          用 GitHub 登录，RepoRadar 会读取你最近的公开 star 来建立口味画像。默认只申请公开资料权限；
          仓库管理和补丁生成需要稍后在仓库页额外授权。
        </p>

        {params.configured === '1' ? (
          <div className="notice success">GitHub 登录已配置完成，请使用 GitHub 登录。</div>
        ) : null}
        {params.error ? (
          <div className="notice">
            登录未完成：账号不在当前内测名单，或 GitHub 授权被取消。需要加入白名单请联系管理员。
          </div>
        ) : null}

        {credentials ? (
          <form action={signInGithubAction}>
            <button className="btn solid" type="submit">
              使用 GitHub 登录
            </button>
          </form>
        ) : (
          <div className="notice">
            尚未配置 GitHub 登录。请先<Link href="/setup">完成 OAuth 配置</Link>。
          </div>
        )}

        {demoMode ? (
          <form action={signInDemoAction}>
            <button className="btn" type="submit">
              以演示账号进入
            </button>
            <p className="muted small">
              演示账号使用预置数据，不会读取你的 GitHub；仓库权限、补丁生成等需要真实授权的功能会提示登录。
            </p>
          </form>
        ) : null}

        {devMode ? (
          <form action={signInDevAction}>
            <button className="btn" type="submit">
              本地演示登录
            </button>
          </form>
        ) : null}
      </div>
    </div>
  )
}
