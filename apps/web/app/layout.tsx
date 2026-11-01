import type { Metadata } from 'next'
import Script from 'next/script'
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister'
import './globals.css'

export const metadata: Metadata = {
  title: 'RepoRadar — 懂你口味的开源项目雷达',
  description: '从 GitHub 自动发现值得关注的开源项目，按你的 star 和兴趣个性化排序。',
}

/**
 * 根布局刻意不读取会话、也不调用 headers()：
 * 这样 /privacy、/terms 这类公开页才能被静态预渲染。
 * 主题脚本改成外链文件，CSP 的 'self' 就够用，不再需要 per-request nonce。
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <Script src="/theme.js" strategy="beforeInteractive" />
      </head>
      <body>
        {children}
        <ServiceWorkerRegister />

        <footer className="site-footer">
          <span>RepoRadar · 懂你口味的开源项目雷达</span>
          <span>
            <a href="/privacy">隐私</a> · <a href="/terms">条款</a> · 证据优先
          </span>
        </footer>
      </body>
    </html>
  )
}
