'use server'

import { createCopilotThread, deleteCopilotThread, getCopilotThread } from '@repo-radar/core'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { getPool } from '@/lib/db'
import { sessionUser } from '@/lib/session'

export async function newCopilotThreadAction(): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')

  const thread = await createCopilotThread(getPool(), Number(currentUser.id))
  revalidatePath('/workbench/copilot')
  redirect(`/workbench/copilot?thread=${thread.id}`)
}

export async function clearCopilotAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')

  const threadId = Number(formData.get('threadId'))
  if (Number.isFinite(threadId)) {
    const thread = await getCopilotThread(getPool(), Number(currentUser.id), threadId)
    if (thread) await deleteCopilotThread(getPool(), Number(currentUser.id), threadId)
  }
  revalidatePath('/workbench/copilot')
  redirect('/workbench/copilot')
}
