import { createHash } from 'node:crypto'
import type { Session } from 'next-auth'
import {
  fetchTokenScopes,
  findUserByLogin,
  getAuthenticatedLogin,
  hasRepoScope,
  loadConfig,
  loadUserGithubToken,
  getPool,
} from '@repo-radar/core'

export interface SessionUser {
  id: string
  login: string
  avatarUrl: string | null
}

type AppUser = NonNullable<Session['user']> & {
  id?: string
  login?: string
  avatarUrl?: string | null
}

export function sessionUser(session: Session | null): SessionUser | null {
  if (!session?.user) return null
  const user = session.user as AppUser
  if (!user.id) return null
  return {
    id: String(user.id),
    login: user.login ?? '',
    avatarUrl: user.avatarUrl ?? null,
  }
}

/**
 * OAuth token 只从加密的用户凭据表读取，不放在 session payload 里，
 * 避免 /api/auth/session 把 token 下发到浏览器。
 */
export async function sessionAccessToken(session: Session | null): Promise<string | null> {
  const user = sessionUser(session)
  if (!user) return null
  try {
    return await loadUserGithubToken(getPool(), Number(user.id))
  } catch {
    return null
  }
}

export function sessionGithubScope(session: Session | null): string | null {
  const scope = (session as (Session & { githubScope?: string }) | null)?.githubScope
  return typeof scope === 'string' && scope.length > 0 ? scope : null
}

export type GithubTokenSource = 'session' | 'env'

/**
 * 优先使用登录用户保存在数据库里的 OAuth token；自托管时允许用 GITHUB_TOKEN 兜底。
 */
export async function resolveGithubToken(
  session: Session | null,
): Promise<{ token: string; source: GithubTokenSource } | null> {
  const token = await sessionAccessToken(session)
  if (token) return { token, source: 'session' }
  const envToken = loadConfig().githubToken
  if (envToken) return { token: envToken, source: 'env' }
  return null
}

export type RepoAccessResult =
  | { access: { token: string; source: GithubTokenSource }; reason: 'none' }
  | { access: null; reason: 'none' | 'env-mismatch' | 'need-repo-scope' }

export interface RepoAccessOptions {
  /** 只读场景（如动态同步）可以只用基础 scope。 */
  requireRepoScope?: boolean
}

const scopeCache = new Map<string, { scopes: string[] | null; expires: number }>()
const SCOPE_TTL = 60_000

function tokenScopeKey(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 24)
}

async function actualTokenScopes(token: string): Promise<string[] | null> {
  const key = tokenScopeKey(token)
  const cached = scopeCache.get(key)
  if (cached && cached.expires > Date.now()) return cached.scopes
  const scopes = await fetchTokenScopes(token)
  scopeCache.set(key, { scopes, expires: Date.now() + SCOPE_TTL })
  return scopes
}

async function hasRepoAccessScope(token: string, knownScope: string | null): Promise<boolean> {
  // JWT 里的 scope 可能落后于真实 token；不要仅凭 knownScope 直接判否。
  if (knownScope && hasRepoScope(knownScope)) return true
  const scopes = await actualTokenScopes(token)
  if (scopes === null) return knownScope === null
  return hasRepoScope(scopes.join(' '))
}

/**
 * 仓库写操作只允许 token 所有者本人执行，避免多用户部署里共用 GITHUB_TOKEN 时误操作。
 */
async function storedTokenFor(login: string): Promise<string | null> {
  try {
    const user = await findUserByLogin(getPool(), login)
    if (!user) return null
    return await loadUserGithubToken(getPool(), user.id)
  } catch {
    return null
  }
}

export async function resolveRepoAccess(
  session: Session | null,
  login: string,
  options: RepoAccessOptions = {},
): Promise<RepoAccessResult> {
  const requireRepoScope = options.requireRepoScope !== false
  const resolved = await resolveGithubToken(session)
  if (!resolved) {
    const stored = await storedTokenFor(login)
    if (!stored) return { access: null, reason: 'none' }
    if (requireRepoScope && !(await hasRepoAccessScope(stored, null))) {
      return { access: null, reason: 'need-repo-scope' }
    }
    return { access: { token: stored, source: 'session' }, reason: 'none' }
  }
  if (resolved.source === 'session') {
    if (requireRepoScope && !(await hasRepoAccessScope(resolved.token, sessionGithubScope(session)))) {
      const stored = await storedTokenFor(login)
      if (
        stored &&
        stored !== resolved.token &&
        (await hasRepoAccessScope(stored, null))
      ) {
        return { access: { token: stored, source: 'session' }, reason: 'none' }
      }
      return { access: null, reason: 'need-repo-scope' }
    }
    return { access: resolved, reason: 'none' }
  }

  try {
    const owner = await getAuthenticatedLogin(resolved.token)
    if (owner && owner.toLowerCase() === login.toLowerCase()) {
      if (requireRepoScope && !(await hasRepoAccessScope(resolved.token, null))) {
        return { access: null, reason: 'need-repo-scope' }
      }
      return { access: resolved, reason: 'none' }
    }
  } catch {
    // 无法确认 token 归属时按不安全处理
  }
  const stored = await storedTokenFor(login)
  if (stored) {
    if (requireRepoScope && !(await hasRepoAccessScope(stored, null))) {
      return { access: null, reason: 'need-repo-scope' }
    }
    return { access: { token: stored, source: 'session' }, reason: 'none' }
  }
  return { access: null, reason: 'env-mismatch' }
}
