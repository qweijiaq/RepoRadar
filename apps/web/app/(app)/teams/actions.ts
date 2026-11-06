'use server'

import {
  addTeamMemberByLogin,
  canAdminTeam,
  canManageTeam,
  canWriteTeam,
  createTeam,
  deleteTeam,
  findTeamForUser,
  isAssignableTeamRole,
  removeTeamMember,
  setTeamDigestEnabled,
  shareTeamProject,
  unshareTeamProject,
  updateTeamMemberRole,
  getPool,
} from '@repo-radar/core'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { assertWritable } from '@/lib/readonly'
import { sessionUser } from '@/lib/session'

async function teamContext(teamId: number) {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')
  assertWritable(currentUser.login)
  const team = await findTeamForUser(getPool(), Number(currentUser.id), teamId)
  return { currentUser, team }
}

export async function createTeamAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')
  assertWritable(currentUser.login)

  const name = String(formData.get('name') ?? '').trim().slice(0, 80)
  if (name.length < 2) redirect('/teams?error=name')

  const id = await createTeam(getPool(), Number(currentUser.id), name)
  revalidatePath('/teams')
  redirect(`/teams?team=${id}&saved=created`)
}

export async function addTeamMemberAction(formData: FormData): Promise<void> {
  const teamId = Number(formData.get('teamId'))
  if (!Number.isFinite(teamId) || teamId <= 0) redirect('/teams?error=team')
  const { team } = await teamContext(teamId)
  if (!team || !canManageTeam(team.role)) redirect(`/teams?team=${teamId}&error=forbidden`)

  const login = String(formData.get('login') ?? '').trim()
  const role = String(formData.get('role') ?? 'member')
  if (!login) redirect(`/teams?team=${teamId}&error=login`)
  if (!isAssignableTeamRole(role)) redirect(`/teams?team=${teamId}&error=role`)

  const result = await addTeamMemberByLogin(getPool(), teamId, login, role)
  revalidatePath('/teams')
  if (!result.ok) {
    redirect(`/teams?team=${teamId}&error=${result.reason}`)
  }
  redirect(`/teams?team=${teamId}&saved=member`)
}

export async function updateTeamMemberRoleAction(formData: FormData): Promise<void> {
  const teamId = Number(formData.get('teamId'))
  const userId = Number(formData.get('userId'))
  if (!Number.isFinite(teamId) || !Number.isFinite(userId)) redirect('/teams?error=team')
  const { team } = await teamContext(teamId)
  if (!team || !canManageTeam(team.role)) redirect(`/teams?team=${teamId}&error=forbidden`)

  const role = String(formData.get('role') ?? '')
  if (!isAssignableTeamRole(role)) redirect(`/teams?team=${teamId}&error=role`)

  const updated = await updateTeamMemberRole(getPool(), teamId, userId, role)
  revalidatePath('/teams')
  redirect(`/teams?team=${teamId}&${updated ? 'saved=role' : 'error=owner'}`)
}

export async function removeTeamMemberAction(formData: FormData): Promise<void> {
  const teamId = Number(formData.get('teamId'))
  const userId = Number(formData.get('userId'))
  if (!Number.isFinite(teamId) || !Number.isFinite(userId)) redirect('/teams?error=team')
  const { currentUser, team } = await teamContext(teamId)
  if (!team || !canManageTeam(team.role)) redirect(`/teams?team=${teamId}&error=forbidden`)
  if (Number(currentUser.id) === userId) redirect(`/teams?team=${teamId}&error=self`)

  const removed = await removeTeamMember(getPool(), teamId, userId)
  revalidatePath('/teams')
  redirect(`/teams?team=${teamId}&${removed ? 'saved=removed' : 'error=owner'}`)
}

export async function setTeamDigestAction(formData: FormData): Promise<void> {
  const teamId = Number(formData.get('teamId'))
  if (!Number.isFinite(teamId) || teamId <= 0) redirect('/teams?error=team')
  const { team } = await teamContext(teamId)
  if (!team || !canManageTeam(team.role)) redirect(`/teams?team=${teamId}&error=forbidden`)

  const enabled = formData.get('enabled') === '1'
  await setTeamDigestEnabled(getPool(), teamId, enabled)
  revalidatePath('/teams')
  redirect(`/teams?team=${teamId}&saved=digest`)
}

export async function shareTeamProjectAction(formData: FormData): Promise<void> {
  const teamId = Number(formData.get('teamId'))
  if (!Number.isFinite(teamId) || teamId <= 0) redirect('/teams?error=team')
  const { currentUser, team } = await teamContext(teamId)
  if (!team || !canWriteTeam(team.role)) redirect(`/teams?team=${teamId}&error=forbidden`)

  const project = String(formData.get('project') ?? '').trim()
  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(project)) {
    redirect(`/teams?team=${teamId}&error=project`)
  }

  await shareTeamProject(getPool(), teamId, project, Number(currentUser.id))
  revalidatePath('/teams')
  redirect(`/teams?team=${teamId}&saved=project`)
}

export async function unshareTeamProjectAction(formData: FormData): Promise<void> {
  const teamId = Number(formData.get('teamId'))
  if (!Number.isFinite(teamId) || teamId <= 0) redirect('/teams?error=team')
  const { team } = await teamContext(teamId)
  if (!team || !canWriteTeam(team.role)) redirect(`/teams?team=${teamId}&error=forbidden`)

  const project = String(formData.get('project') ?? '').trim()
  if (!project) redirect(`/teams?team=${teamId}&error=project`)

  await unshareTeamProject(getPool(), teamId, project)
  revalidatePath('/teams')
  redirect(`/teams?team=${teamId}&saved=unshared`)
}

export async function deleteTeamAction(formData: FormData): Promise<void> {
  const teamId = Number(formData.get('teamId'))
  if (!Number.isFinite(teamId) || teamId <= 0) redirect('/teams?error=team')
  const { currentUser, team } = await teamContext(teamId)
  if (!team || !canAdminTeam(team.role)) redirect(`/teams?team=${teamId}&error=forbidden`)

  const deleted = await deleteTeam(getPool(), teamId, Number(currentUser.id))
  revalidatePath('/teams')
  redirect(deleted ? '/teams?saved=deleted' : `/teams?team=${teamId}&error=delete`)
}
