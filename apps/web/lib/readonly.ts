import { redirect } from 'next/navigation'

export const DEMO_LOGIN = 'demo-radar'

export function isDemoLogin(login: string | null | undefined): boolean {
  return (login ?? '').trim().toLowerCase() === DEMO_LOGIN
}

/**
 * 演示账号只读：所有写操作统一跳回首页并带提示。
 * 演示账号没有 GitHub token，但本地反馈/订阅/设置仍然会写库，所以在这里拦。
 */
export function assertWritable(login: string | null | undefined): void {
  if (isDemoLogin(login)) redirect('/feed')
}
