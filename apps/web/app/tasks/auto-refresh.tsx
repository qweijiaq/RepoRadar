'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export function JobAutoRefresh() {
  const router = useRouter()

  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 2500)
    return () => clearInterval(timer)
  }, [router])

  return null
}
