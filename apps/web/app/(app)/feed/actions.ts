'use server'

import {
  dismissFeedItem,
  dismissOnboarding,
  isFeedDismissReason,
  isRadarMode,
  markFeedItemDone,
  saveRadarMode,
  setIntegrationOutcome,
  getPool,
} from '@repo-radar/core'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { sessionUser } from '@/lib/session'

export async function dismissFeedItemAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')

  const key = String(formData.get('itemKey') ?? '').trim().slice(0, 240)
  const kind = String(formData.get('kind') ?? '').trim().slice(0, 40)
  const reason = String(formData.get('reason') ?? '').trim()
  const note = String(formData.get('note') ?? '').trim().slice(0, 200)
  const requested = String(formData.get('returnTo') ?? '')
  const returnTo = requested.startsWith('/feed') ? requested : '/feed'

  if (!key || !kind || !isFeedDismissReason(reason)) redirect(returnTo)

  await dismissFeedItem(getPool(), Number(currentUser.id), key, kind, reason, note || null)
  revalidatePath('/feed')
  redirect(returnTo)
}

export async function dismissOnboardingAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')
  await dismissOnboarding(getPool(), Number(currentUser.id))
  revalidatePath('/feed')
  const requested = String(formData.get('returnTo') ?? '')
  redirect(requested.startsWith('/feed') ? requested : '/feed')
}

export async function markFeedItemDoneAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')

  const key = String(formData.get('itemKey') ?? '').trim().slice(0, 240)
  const kind = String(formData.get('kind') ?? '').trim().slice(0, 40)
  const note = String(formData.get('note') ?? '').trim().slice(0, 200)
  const requested = String(formData.get('returnTo') ?? '')
  const returnTo = requested.startsWith('/feed') ? requested : '/feed'
  if (!key || !kind) redirect(returnTo)

  const pool = getPool()
  const userId = Number(currentUser.id)
  await markFeedItemDone(pool, userId, key, kind, note || null)

  if (kind === 'integration' && key.startsWith('integration:')) {
    const rest = key.slice('integration:'.length)
    const separator = rest.lastIndexOf(':')
    if (separator > 0) {
      const project = rest.slice(0, separator)
      const repo = rest.slice(separator + 1)
      if (project && repo) await setIntegrationOutcome(pool, userId, project, repo, 'adopted')
    }
  }

  revalidatePath('/feed')
  revalidatePath('/workbench/maintain')
  revalidatePath('/workbench/integrations')
  revalidatePath('/workbench/watch')
  redirect(returnTo)
}

export async function setRadarModeAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')

  const mode = String(formData.get('mode') ?? '')
  if (!isRadarMode(mode)) redirect('/feed')
  await saveRadarMode(getPool(), Number(currentUser.id), mode)
  revalidatePath('/feed')
  redirect('/feed')
}
