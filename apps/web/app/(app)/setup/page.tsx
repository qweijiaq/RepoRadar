import Link from 'next/link'
import { headers } from 'next/headers'
import { isLocalSetupHost } from '@repo-radar/core'
import { saveOAuthConfigAction } from '@/app/actions'
import { auth } from '@/auth'
import { isAdminUser } from '@/lib/admin'
import { maskClientId, resolveGithubCredentials } from '@/lib/oauth-config'
import { sessionUser } from '@/lib/session'
import { CopyButton } from '@/components/ui/CopyButton'

export const dynamic = 'force-dynamic'

interface SetupPageProps {
  searchParams: Promise<{ error?: string }>
}

export default async function SetupPage({ searchParams }: SetupPageProps) {
  const params = await searchParams
  const session = await auth()
  const currentUser = sessionUser(session)
  const credentials = await resolveGithubCredentials()
  const admin = currentUser ? await isAdminUser(currentUser) : false

  const headerList = await headers()
  const host = headerList.get('host') ?? 'localhost:3000'
  const forwardedProto = headerList.get('x-forwarded-proto')
  const isLocal = isLocalSetupHost(host)
  const proto = forwardedProto ?? (isLocal ? 'http' : 'https')
  const baseUrl = `${proto}://${host}`
  const callbackUrl = `${baseUrl}/api/auth/callback/github`
  const setupToken = process.env.SETUP_TOKEN?.trim() ?? ''
  const requiresSetupToken = !isLocal && Boolean(setupToken)
  const setupLocked = !isLocal && !setupToken

  if (credentials) {
    return (
      <div className="page narrow">
        <p className="eyebrow">配置</p>
        <h1>GitHub 登录已配置</h1>
        <p className="muted">
          当前来源：
          {credentials.source === 'env' ? '环境变量 AUTH_GITHUB_ID / AUTH_GITHUB_SECRET' : '数据库'}
          {credentials.source === 'database' ? (
            <>
              {' '}
              · Client ID <code>{maskClientId(credentials.clientId)}</code>
            </>
          ) : null}
        </p>
        <div className="hero-actions">
          <Link className="btn solid" href="/login">
            去登录
          </Link>
          {currentUser && admin ? (
            <Link className="btn" href="/settings">
              在设置中修改
            </Link>
          ) : null}
        </div>
        {credentials.source === 'env' ? (
          <p className="muted small">如需更换，请修改环境变量后重启服务。</p>
        ) : null}
      </div>
    )
  }

  return (
    <div className="page narrow">
      <p className="eyebrow">首次配置</p>
      <h1>配置 GitHub 登录</h1>
      <p className="muted">
        RepoRadar 需要一对 GitHub OAuth 凭据来读取你的公开 star。凭据只保存在你自己的数据库里，Client Secret
        会加密存储。
      </p>

      {params.error === 'invalid' ? (
        <div className="notice">Client ID 或 Client Secret 格式不正确，请检查后重试。</div>
      ) : null}
      {params.error === 'token' ? <div className="notice">初始化令牌不正确。</div> : null}
      {params.error === 'locked' ? (
        <div className="notice">
          当前不是本机访问，且服务端没有配置 <code>SETUP_TOKEN</code>，初始化已被锁定。请先在服务器设置
          SETUP_TOKEN 并重启，或用 localhost 访问。
        </div>
      ) : null}

      <section className="panel">
        <h2>创建 OAuth App</h2>
        <ol className="steps">
          <li>
            打开{' '}
            <a href="https://github.com/settings/developers" target="_blank" rel="noreferrer">
              GitHub → Settings → Developer settings → OAuth Apps
            </a>
            ，点击 <strong>New OAuth App</strong>。
          </li>
          <li>
            Application name 随便填，例如 <code>RepoRadar</code>。
          </li>
          <li>
            Homepage URL 填 <code>{baseUrl}</code>，Authorization callback URL 必须填下面这个地址：
            <div className="code-row">
              <code>{callbackUrl}</code>
              <CopyButton value={callbackUrl} />
            </div>
          </li>
          <li>
            创建后复制 <strong>Client ID</strong>，再点击 <strong>Generate a new client secret</strong>{' '}
            生成并复制 <strong>Client Secret</strong>（只显示一次）。
          </li>
        </ol>
      </section>

      {setupLocked ? null : (
        <form className="panel" action={saveOAuthConfigAction}>
          <h2>填写凭据</h2>
          <label className="field">
            <span>Client ID</span>
            <input name="clientId" autoComplete="off" placeholder="例如 Ov23liAbCdEfGhIjKlMn" />
          </label>
          <label className="field">
            <span>Client Secret</span>
            <input
              name="clientSecret"
              type="password"
              autoComplete="off"
              placeholder="40 位十六进制字符串"
            />
          </label>
          {requiresSetupToken ? (
            <label className="field">
              <span>初始化令牌</span>
              <input
                name="setupToken"
                type="password"
                autoComplete="off"
                placeholder="服务端 SETUP_TOKEN"
              />
            </label>
          ) : null}
          <p className="muted small">保存后会自动启用 GitHub 登录，可以随时在设置页更新或清除。</p>
          <div className="form-actions">
            <button className="btn solid" type="submit">
              保存并启用 GitHub 登录
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
