import { NavLink } from '@/components/NavLink'
import { SiteBrand } from '@/components/SiteBrand'
import { ThemeToggle } from '@/components/ThemeToggle'

/**
 * 公开页（隐私、条款）的布局：不读会话，保持可静态预渲染。
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="site-header">
        <SiteBrand />
        <nav className="site-nav">
          <NavLink href="/login">登录</NavLink>
          <div className="nav-utilities">
            <ThemeToggle compact />
          </div>
        </nav>
      </header>

      <main className="site-main">{children}</main>
    </>
  )
}
