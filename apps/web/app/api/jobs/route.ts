import { NextResponse } from 'next/server'
import { listJobs } from '@repo-radar/core'
import { auth } from '@/auth'
import { getPool } from '@/lib/db'
import { sessionUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const jobs = await listJobs(getPool(), Number(currentUser.id), 30)
  return NextResponse.json({
    active: jobs.filter((job) => job.status === 'queued' || job.status === 'running').length,
    jobs: jobs.map((job) => ({
      id: job.id,
      kind: job.kind,
      title: job.title,
      status: job.status,
      progress: job.progress,
      result: job.result,
      error: job.error,
      createdAt: job.createdAt,
    })),
  })
}
