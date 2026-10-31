'use client'

import { useEffect } from 'react'

/**
 * 应用打开时每 5 分钟轻量触发一次 GitHub 动态轮询；不需要公网 Webhook。
 */
export function ActivityHeartbeat() {
  useEffect(() => {
    let cancelled = false

    async function tick() {
      if (cancelled || document.visibilityState !== 'visible') return
      try {
        await fetch('/api/activity/sync', { method: 'POST' })
      } catch {
        // 网络问题不提示，下一次心跳再试
      }
    }

    const first = setTimeout(tick, 3000)
    const timer = setInterval(tick, 5 * 60 * 1000)
    return () => {
      cancelled = true
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [])

  return null
}
