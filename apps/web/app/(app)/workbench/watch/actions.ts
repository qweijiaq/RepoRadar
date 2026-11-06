'use server'

import {
  canWriteTeam,
  createWatchIntent,
  deleteWatchIntent,
  findTeamForUser,
  listWatchIntents,
  getPool,
} from '@repo-radar/core'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { assertWritable } from '@/lib/readonly'
import { sessionUser } from '@/lib/session'

const MAX_INTENTS = 10

export async function createWatchIntentAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')
  assertWritable(currentUser.login)

  const text = String(formData.get('text') ?? '').trim()
  if (text.length < 5 || text.length > 300) redirect('/workbench/watch?error=invalid')

  const pool = getPool()
  const userId = Number(currentUser.id)
  const existing = await listWatchIntents(pool, userId)
  if (existing.length >= MAX_INTENTS) redirect('/workbench/watch?error=limit')

  const requestedTeam = Number(formData.get('teamId'))
  const teamId = Number.isFinite(requestedTeam) && requestedTeam > 0 ? requestedTeam : null
  if (teamId) {
    const team = await findTeamForUser(pool, userId, teamId)
    if (!team || !canWriteTeam(team.role)) redirect('/workbench/watch?error=team')
  }

  await createWatchIntent(pool, userId, text, teamId)
  revalidatePath('/workbench/watch')
  redirect('/workbench/watch?created=1')
}

export async function deleteWatchIntentAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')
  assertWritable(currentUser.login)

  const id = Number(formData.get('id'))
  if (Number.isFinite(id)) {
    await deleteWatchIntent(getPool(), Number(currentUser.id), id)
    revalidatePath('/workbench/watch')
  }
  redirect('/workbench/watch')
}
