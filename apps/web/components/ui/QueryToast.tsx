'use client'

import { useEffect, useState } from 'react'

export interface QueryToastConfig {
  paramKey?: string
  code: string | null | undefined
  messages: Record<string, string>
  tone?: 'error' | 'success'
  tones?: Record<string, 'error' | 'success'>
  duration?: number
}

export function QueryToast({
  code,
  paramKey = 'error',
  messages,
  tone = 'error',
  tones,
  duration = 5000,
}: QueryToastConfig) {
  const [visible, setVisible] = useState(false)
  const resolvedTone = code ? (tones?.[code] ?? tone) : tone

  useEffect(() => {
    const message = code ? messages[code] : undefined
    if (!message) {
      setVisible(false)
      return
    }

    setVisible(true)
    const url = new URL(window.location.href)
    if (url.searchParams.has(paramKey)) {
      url.searchParams.delete(paramKey)
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
    }

    const timer = window.setTimeout(() => setVisible(false), duration)
    return () => window.clearTimeout(timer)
  }, [code, messages, paramKey, duration])

  const message = code ? messages[code] : undefined
  if (!visible || !message) return null

  return (
    <div className={`query-toast ${resolvedTone}`} role="status">
      <span>{message}</span>
      <button type="button" className="query-toast-close" onClick={() => setVisible(false)} aria-label="关闭提示">
        ×
      </button>
    </div>
  )
}

export function QueryToastGroup({ toasts }: { toasts: QueryToastConfig[] }) {
  return (
    <>
      {toasts.map((toast) => (
        <QueryToast key={`${toast.paramKey ?? 'error'}:${toast.code ?? ''}`} {...toast} />
      ))}
    </>
  )
}
