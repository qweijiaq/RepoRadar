'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

interface JobSummary {
  id: number
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  title: string
}

export function JobsIndicator() {
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
    const timer = setInterval(load, 3000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  const active = jobs.filter((job) => job.status === 'queued' || job.status === 'running').length

  return (
    <Link className="nav-link job-indicator" href="/tasks" aria-label={`后台任务${active > 0 ? `，${active} 个运行中` : ''}`}>
      任务
      {active > 0 ? <span className="nav-badge">{active}</span> : null}
    </Link>
  )
}
