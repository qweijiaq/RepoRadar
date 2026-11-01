'use client'

import { useEffect } from 'react'
import './globals.css'

export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error('[app] 根布局渲染失败', error)
    try {
      const theme = localStorage.getItem('radar-theme')
      document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light'
    } catch {
      // localStorage 不可用时保持默认配色
    }
  }, [error])

  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <main className="page narrow">
          <p className="eyebrow">服务异常</p>
          <h1>RepoRadar 暂时不可用</h1>
          <p className="muted">
            页面在渲染过程中抛出了未捕获的错误。重试通常能恢复；如果持续出现，请查看服务端日志。
          </p>
          <p>
            <button className="btn solid" type="button" onClick={() => retry()}>
              重新加载
            </button>
          </p>
        </main>
      </body>
    </html>
  )
}
