import type { Session } from 'next-auth'
import {
  fetchTokenScopes,
  findUserByLogin,
  getAuthenticatedLogin,
  hasRepoScope,
  loadConfig,
  loadUserGithubToken,
} from '@repo-radar/core'
import { getPool } from './db'

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

export function sessionAccessToken(session: Session | null): string | null {
  const token = (session as (Session & { accessToken?: string }) | null)?.accessToken
  return typeof token === 'string' && token.length > 0 ? token : null
}

export function sessionGithubScope(session: Session | null): string | null {
  const scope = (session as (Session & { githubScope?: string }) | null)?.githubScope
  return typeof scope === 'string' && scope.length > 0 ? scope : null
}

export type GithubTokenSource = 'session' | 'env'

/**
 * 优先使用登录用户的 OAuth token；自托管时允许用 GITHUB_TOKEN 兜底。
 */
export function resolveGithubToken(session: Session | null): { token: string; source: GithubTokenSource } | null {
  const token = sessionAccessToken(session)
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

async function hasRepoAccessScope(token: string, knownScope: string | null): Promise<boolean> {
  if (knownScope) return hasRepoScope(knownScope)
  const scopes = await fetchTokenScopes(token)
  if (scopes === null) return true
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
  const resolved = resolveGithubToken(session)
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
