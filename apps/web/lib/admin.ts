import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { getPool } from './db'
import { sessionUser, type SessionUser } from './session'

export function adminLogins(): string[] {
  return (process.env.ADMIN_LOGINS ?? '')
    .split(/[,\s]+/)
    .map((login) => login.trim().replace(/^@/, '').toLowerCase())
    .filter(Boolean)
}

/**
 * 未配置 ADMIN_LOGINS 时，最早注册的用户作为管理员，保证自托管首次部署可用。
 * 公开部署建议显式设置 ADMIN_LOGINS。
 */
export async function isAdminUser(user: SessionUser | null): Promise<boolean> {
  if (!user) return false
  const configured = adminLogins()
  if (configured.length > 0) return configured.includes(user.login.toLowerCase())
  try {
    const { rows } = await getPool().query<{ id: string }>(`SELECT id FROM users ORDER BY id LIMIT 1`)
    return rows[0]?.id === user.id
  } catch {
    return false
  }
}

export async function requireAdmin(): Promise<SessionUser> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')
  if (!(await isAdminUser(currentUser))) redirect('/settings?admin=denied')
  return currentUser
}

export async function currentAdminState(): Promise<{ user: SessionUser | null; isAdmin: boolean }> {
  const session = await auth()
  const user = sessionUser(session)
  return { user, isAdmin: await isAdminUser(user) }
}
