'use server'

import {
  addNotification,
  fetchIssueContext,
  generateIssuePlan,
  loadConfig,
  loadStoredLlmConfig,
  saveIssuePlan,
} from '@repo-radar/core'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { getPool } from '@/lib/db'
import { guardAiQuota } from '@/lib/quota-guard'
import { loadProjectContext } from '@/lib/project-context'
import { resolveRepoAccess, sessionUser } from '@/lib/session'

export async function generateIssuePlanAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')

  const repo = String(formData.get('repo') ?? '').trim()
  const issueNumber = Number(formData.get('number'))
  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repo) || !Number.isFinite(issueNumber) || issueNumber <= 0) {
    redirect('/maintain?error=issue-invalid')
  }

  const access = await resolveRepoAccess(session, currentUser.login)
  if (!access.access) redirect('/maintain?error=need-token')

  const pool = getPool()
  await guardAiQuota(pool, Number(currentUser.id))
  const llm = loadConfig().llm ?? (await loadStoredLlmConfig(pool))
  if (!llm) redirect('/settings?llm=missing')

  const token = access.access.token
  const issue = await fetchIssueContext(token, repo, issueNumber)
  if (!issue) redirect('/maintain?error=issue-not-found')

  let planId = 0
  try {
    const project = await loadProjectContext(repo, token)
    const plan = await generateIssuePlan(issue, project, llm)
    planId = await saveIssuePlan(pool, Number(currentUser.id), {
      plan,
      repo,
      issueNumber,
      issueTitle: issue.title,
      generatedAt: new Date().toISOString(),
      model: llm.model,
      providerId: llm.providerId ?? null,
    })
    await addNotification(pool, Number(currentUser.id), {
      kind: 'issue-plan',
      title: 'Issue 修复方案已生成',
      body: `${repo} #${issueNumber}：${issue.title}`,
      url: `/issue-plan?repo=${encodeURIComponent(repo)}&number=${issueNumber}&plan=${planId}`,
    })
  } catch (error) {
    console.error('[issue-plan] 生成失败：', error)
    const detail = error instanceof Error ? error.message : ''
    redirect(`/maintain?error=${/JSON|结构不符合/.test(detail) ? 'issue-format' : 'issue-generate'}`)
  }

  revalidatePath('/maintain')
  redirect(`/issue-plan?repo=${encodeURIComponent(repo)}&number=${issueNumber}&plan=${planId}`)
}
