'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

interface JobSummary {
  id: number
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  title: string
}

export function JobsIndicator({ compact = false }: { compact?: boolean }) {
  const [jobs, setJobs] = useState<JobSummary[]>([])

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const response = await fetch('/api/jobs', { cache: 'no-store' })
        if (!response.ok) return
        const data = (await response.json()) as { jobs?: JobSummary[] }
        if (!cancelled) setJobs(data.jobs ?? [])
      } catch {
        // 轮询失败不打断页面
      }
    }

    void load()
    const timer = setInterval(() => void load(), 3000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  const active = jobs.filter((job) => job.status === 'queued' || job.status === 'running').length

  return (
    <Link
      className={compact ? 'icon-button job-indicator compact' : 'nav-link job-indicator'}
      href="/tasks"
      aria-label={`后台任务${active > 0 ? `，${active} 个运行中` : ''}`}
      title="后台任务"
    >
      {compact ? (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7">
          <path d="M9 6h11M9 12h11M9 18h11" />
          <path d="m4 6 1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2" />
        </svg>
      ) : (
        '任务'
      )}
      {active > 0 ? <span className="nav-badge">{active}</span> : null}
    </Link>
  )
}
