import type { Session } from 'next-auth'
import NextAuth from 'next-auth'
import type { Provider } from 'next-auth/providers'
import Credentials from 'next-auth/providers/credentials'
import GitHub from 'next-auth/providers/github'
import { GITHUB_BASE_SCOPES, saveUserGithubToken, getPool } from '@repo-radar/core'
import { resolveGithubCredentials } from './lib/oauth-config'
import { syncUserTaste } from './lib/sync'
import { ensureUser } from './lib/users'

export const { handlers, auth, signIn, signOut } = NextAuth(async () => {
  const github = await resolveGithubCredentials()
  const devMode = process.env.AUTH_DEV_MODE === '1' && process.env.NODE_ENV !== 'production'
  const demoMode = process.env.RADAR_DEMO_MODE === '1'

  const providers: Provider[] = []

  if (github) {
    providers.push(
      GitHub({
        clientId: github.clientId,
        clientSecret: github.clientSecret,
        authorization: { params: { scope: GITHUB_BASE_SCOPES } },
      }),
    )
  }

  if (demoMode) {
    providers.push(
      Credentials({
        id: 'demo-radar',
        name: '演示账号',
        credentials: {},
        async authorize() {
          return { id: 'demo-radar', name: 'Demo Radar', email: 'demo@radar.local' }
        },
      }),
    )
  }

  if (devMode) {
    providers.push(
      Credentials({
        id: 'dev',
        name: '本地演示',
        credentials: {},
        async authorize() {
          return { id: 'dev-user', name: '演示用户', email: 'dev@local' }
        },
      }),
    )
  }

  // Auth.js 至少需要一个 provider；未配置时放一个永远失败的占位，保证设置页能正常渲染
  if (providers.length === 0) {
    providers.push(
      Credentials({
        id: 'unconfigured',
        name: '未配置',
        credentials: {},
        async authorize() {
          return null
        },
      }),
    )
  }

  return {
    trustHost: true,
    session: { strategy: 'jwt' },
    providers,
    callbacks: {
      async signIn({ account, profile }) {
        if (account?.provider !== 'github') return true
        const allowed = new Set(
          [...(process.env.ALLOWED_LOGINS ?? '').split(/[,\s]+/), ...(process.env.ADMIN_LOGINS ?? '').split(/[,\s]+/)]
            .map((login) => login.trim().replace(/^@/, '').toLowerCase())
            .filter(Boolean),
        )
        if (allowed.size === 0) return true
        const login = (profile as { login?: string } | null)?.login?.toLowerCase()
        return Boolean(login && allowed.has(login))
      },
      async jwt({ token, account, profile }) {
        if (account?.provider === 'github') {
          if (account.access_token) token.accessToken = account.access_token
          if (typeof account.scope === 'string') token.githubScope = account.scope
          const githubProfile = (profile ?? {}) as {
            id?: number | string
            login?: string
            name?: string | null
            email?: string | null
            avatar_url?: string
          }
          if (githubProfile.login) {
            token.login = githubProfile.login
            token.avatarUrl = githubProfile.avatar_url ?? null
            try {
              const userId = await ensureUser({
                login: githubProfile.login,
                displayName: githubProfile.name ?? null,
                avatarUrl: githubProfile.avatar_url ?? null,
                githubId: githubProfile.id ? Number(githubProfile.id) : null,
                email: githubProfile.email ?? null,
              })
              token.userId = userId
              if (account.access_token) {
                try {
                  await saveUserGithubToken(getPool(), userId, account.access_token)
                } catch (error) {
                  console.error('[auth] 保存后台同步 token 失败：', error)
                }
                const count = await syncUserTaste(userId, githubProfile.login, account.access_token)
                console.log(`[auth] 已同步 ${githubProfile.login} 的画像（${count} 个 star）`)
              }
            } catch (error) {
              console.error('[auth] 用户同步失败：', error)
            }
          }
        }

        if (account?.provider === 'demo-radar') {
          try {
            const userId = await ensureUser({
              login: 'demo-radar',
              displayName: 'Demo Radar',
              avatarUrl: null,
              githubId: 999001,
            })
            token.userId = userId
            token.login = 'demo-radar'
            token.avatarUrl = null
          } catch (error) {
            console.error('[auth] 演示账号创建失败：', error)
          }
        }

        if (account?.provider === 'dev') {
          try {
            const userId = await ensureUser({
              login: 'demo',
              displayName: '演示用户',
              avatarUrl: null,
              githubId: null,
            })
            token.userId = userId
            token.login = 'demo'
            token.avatarUrl = null
          } catch (error) {
            console.error('[auth] 演示用户创建失败：', error)
          }
        }

        return token
      },
      async session({ session, token }) {
        const user = session.user as
          | (NonNullable<Session['user']> & { id?: string; login?: string; avatarUrl?: string | null })
          | undefined
        if (user) {
          user.id = String(token.userId ?? '')
          user.login = typeof token.login === 'string' ? token.login : ''
          user.avatarUrl = typeof token.avatarUrl === 'string' ? token.avatarUrl : null
        }
        // 不要把 accessToken 挂到 session 上：/api/auth/session 会序列化整个 session。
        // 服务端需要 token 时统一从加密的用户凭据表读取。
        ;(session as Session & { githubScope?: string }).githubScope =
          typeof token.githubScope === 'string' ? token.githubScope : undefined
        return session
      },
    },
    pages: { signIn: '/login' },
  }
})
