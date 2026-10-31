'use server'

import { cancelJob, getJob, recoverStaleJobs } from '@repo-radar/core'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { getPool } from '@/lib/db'
import { resumeJob } from '@/lib/ai-jobs/runner'
import { sessionUser } from '@/lib/session'

async function jobContext(formData: FormData): Promise<{ userId: number; jobId: number } | null> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')
  const jobId = Number(formData.get('id'))
  if (!Number.isFinite(jobId)) return null
  const job = await getJob(getPool(), Number(currentUser.id), jobId)
  if (!job) return null
  return { userId: Number(currentUser.id), jobId }
}

export async function cancelJobAction(formData: FormData): Promise<void> {
  const context = await jobContext(formData)
  if (context) {
    await cancelJob(getPool(), context.jobId)
    revalidatePath('/tasks')
  }
  redirect('/tasks')
}

export async function retryJobAction(formData: FormData): Promise<void> {
  const context = await jobContext(formData)
  if (context) {
    await resumeJob(getPool(), context.userId, context.jobId)
    revalidatePath('/tasks')
  }
  redirect('/tasks')
}

export async function recoverJobsAction(): Promise<void> {
  await recoverStaleJobs(getPool())
  revalidatePath('/tasks')
  redirect('/tasks')
}
