import Link from 'next/link'
import Script from 'next/script'
import { Suspense } from 'react'
import { auth } from '@/auth'
import { ActivityHeartbeat } from '@/components/ActivityHeartbeat'
import { CommandPalette } from '@/components/CommandPalette'
import { JobsIndicator } from '@/components/JobsIndicator'
import { NavLink } from '@/components/NavLink'
import { SiteBrand } from '@/components/SiteBrand'
import { ThemeToggle } from '@/components/ThemeToggle'
import { UnreadBadge } from '@/components/UnreadBadge'
import { isDemoLogin } from '@/lib/readonly'
import { sessionUser } from '@/lib/session'
import { signOutAction } from '@/app/actions'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  const currentUser = sessionUser(session)

  return (
    <>
      <header className="site-header">
        <SiteBrand />

        <nav className="site-nav">
          {currentUser ? (
            <>
              <NavLink href="/feed">雷达</NavLink>
              <NavLink href="/discover">发现</NavLink>
              <NavLink href="/trends">趋势</NavLink>
              <NavLink href="/daily">榜单</NavLink>
              <NavLink href="/workbench">工作台</NavLink>
              <NavLink href="/library">建议库</NavLink>
              <NavLink href="/repos">仓库</NavLink>
              <NavLink href="/settings">设置</NavLink>
              <div className="nav-utilities">
                <CommandPalette compact />
                <Link className="icon-button inbox-button" href="/inbox" aria-label="动态" title="动态">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <path d="M6 9a6 6 0 1 1 12 0v4.2l1.6 2.4a1 1 0 0 1-.8 1.6H5.2a1 1 0 0 1-.8-1.6L6 13.2Z" />
                    <path d="M10 20h4" />
                  </svg>
                  <Suspense fallback={null}>
                    <UnreadBadge userId={Number(currentUser.id)} />
                  </Suspense>
                </Link>
                <Link className="icon-button" href="/workbench/copilot" aria-label="问雷达" title="问雷达">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <path d="M12 3.5 13.6 9l5.4 1.6-5.4 1.6L12 17.7l-1.6-5.5L5 10.6 10.4 9Z" />
                    <path d="M18.5 16.5 19.2 19l2.3.8-2.3.8-.7 2.4-.7-2.4-2.3-.8 2.3-.8Z" />
                  </svg>
                </Link>
                <JobsIndicator compact />
                <ActivityHeartbeat />
                <ThemeToggle compact />
                <span className="nav-user">{currentUser.login}</span>
                <form action={signOutAction}>
                  <button className="link-button" type="submit">
                    退出
                  </button>
                </form>
              </div>
            </>
          ) : (
            <NavLink href="/login">登录</NavLink>
          )}
        </nav>
      </header>

      {currentUser && isDemoLogin(currentUser.login) ? (
        <div className="notice demo-banner">
          演示账号只读：反馈、订阅、设置和生成任务已禁用，浏览和搜索不受影响。
        </div>
      ) : null}

      <main className="site-main">{children}</main>

      {process.env.NODE_ENV !== 'production' ? (
        <Script src="/dev-sw-cleanup.js" />
      ) : null}
    </>
  )
}
