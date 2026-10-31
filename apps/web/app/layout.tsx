import type { Metadata } from 'next'
import Link from 'next/link'
import { countUnreadNotifications } from '@repo-radar/core'
import { auth } from '@/auth'
import { ActivityHeartbeat } from '@/components/ActivityHeartbeat'
import { CommandPalette } from '@/components/CommandPalette'
import { JobsIndicator } from '@/components/JobsIndicator'
import { NavLink } from '@/components/NavLink'
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister'
import { ThemeToggle } from '@/components/ThemeToggle'
import { getPool } from '@/lib/db'
import { sessionUser } from '@/lib/session'
import { signOutAction } from './actions'
import './globals.css'

export const metadata: Metadata = {
  title: 'RepoRadar — 懂你口味的开源项目雷达',
  description: '从 GitHub 自动发现值得关注的开源项目，按你的 star 和兴趣个性化排序。',
}

const THEME_SCRIPT = `try{var t=localStorage.getItem('radar-theme');document.documentElement.dataset.theme=t==='dark'?'dark':'light'}catch(e){document.documentElement.dataset.theme='light'}`

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  const currentUser = sessionUser(session)
  const unread = currentUser ? await countUnreadNotifications(getPool(), Number(currentUser.id)) : 0

  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <header className="site-header">
          <Link className="brand" href="/">
            <span className="seal" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.4">
                <circle cx="12" cy="12" r="9" opacity="0.35" />
                <circle cx="12" cy="12" r="5.2" opacity="0.65" />
                <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
                <path d="M12 2v3M12 19v3M2 12h3M19 12h3" opacity="0.5" />
              </svg>
            </span>
            <span className="brand-text">
              <span className="brand-title">REPORADAR</span>
              <span className="brand-sub">OPEN SOURCE RADAR</span>
            </span>
          </Link>

          <nav className="site-nav">
            {currentUser ? (
              <>
                <NavLink href="/feed">雷达</NavLink>
                <NavLink href="/issue">周报</NavLink>
                <NavLink href="/maintain">维护</NavLink>
                <NavLink href="/copilot">问雷达</NavLink>
                <NavLink href="/watch">关注</NavLink>
                <NavLink href="/collections">收藏</NavLink>
                <NavLink href="/integrations">接入</NavLink>
                <NavLink href="/repos">仓库</NavLink>
                <NavLink href="/inbox">
                  动态
                  {unread > 0 ? <span className="nav-badge">{unread}</span> : null}
                </NavLink>
                <NavLink href="/history">历史</NavLink>
                <JobsIndicator />
                <ActivityHeartbeat />
                <NavLink href="/settings">设置</NavLink>
                <CommandPalette />
                <span className="nav-user">{currentUser.login}</span>
                <form action={signOutAction}>
                  <button className="link-button" type="submit">
                    退出
                  </button>
                </form>
              </>
            ) : (
              <NavLink href="/login">登录</NavLink>
            )}
            <ThemeToggle />
          </nav>
        </header>

        <main className="site-main">{children}</main>
        <ServiceWorkerRegister />

        <footer className="site-footer">
          <span>RepoRadar · 懂你口味的开源项目雷达</span>
          <span>证据优先 · 基于真实 release 与 star 数据</span>
        </footer>
      </body>
    </html>
  )
}
