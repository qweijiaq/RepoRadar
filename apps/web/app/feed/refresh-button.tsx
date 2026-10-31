'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function RefreshFeedButton({ label = '刷新雷达' }: { label?: string }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  function refresh() {
    setPending(true)
    const params = new URLSearchParams(window.location.search)
    params.set('refresh', String(Date.now()))
    router.push(`/feed?${params.toString()}`)
    setTimeout(() => setPending(false), 1200)
  }

  return (
    <button className="btn small" type="button" onClick={refresh} disabled={pending}>
      {pending ? '刷新中…' : label}
    </button>
  )
}
