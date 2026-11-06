'use server'

import { cancelJob, getJob, isQuotaError, getPool } from '@repo-radar/core'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { resumeJob } from '@repo-radar/worker'
import { assertWritable } from '@/lib/readonly'
import { sessionUser } from '@/lib/session'

async function jobContext(formData: FormData): Promise<{ userId: number; jobId: number } | null> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')
  assertWritable(currentUser.login)
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

function selectedJobIds(formData: FormData): number[] {
  return [
    ...new Set(
      formData
        .getAll('jobIds')
        .map((value) => Number(value))
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  ]
}

async function bulkContext(): Promise<{ userId: number }> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')
  assertWritable(currentUser.login)
  return { userId: Number(currentUser.id) }
}

export async function bulkCancelJobsAction(formData: FormData): Promise<void> {
  const { userId } = await bulkContext()
  const ids = selectedJobIds(formData)
  for (const id of ids) {
    const job = await getJob(getPool(), userId, id)
    if (job) await cancelJob(getPool(), id)
  }
  revalidatePath('/tasks')
  redirect('/tasks')
}

export async function bulkRetryJobsAction(formData: FormData): Promise<void> {
  const { userId } = await bulkContext()
  const ids = selectedJobIds(formData)
  for (const id of ids) {
    const job = await getJob(getPool(), userId, id)
    if (!job) continue
    try {
      await resumeJob(getPool(), userId, id)
    } catch (error) {
      if (isQuotaError(error)) redirect(`/tasks?quota=${encodeURIComponent(error.message)}`)
      throw error
    }
  }
  revalidatePath('/tasks')
  redirect('/tasks')
}

export async function retryJobAction(formData: FormData): Promise<void> {
  const context = await jobContext(formData)
  if (context) {
    try {
      await resumeJob(getPool(), context.userId, context.jobId)
      revalidatePath('/tasks')
    } catch (error) {
      if (isQuotaError(error)) redirect(`/tasks?quota=${encodeURIComponent(error.message)}`)
      throw error
    }
  }
  redirect('/tasks')
}
