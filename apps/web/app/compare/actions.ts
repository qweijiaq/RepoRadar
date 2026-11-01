'use server'

import {
  addNotification,
  findLatestComparisonReport,
  findLatestIntegrationReport,
  findRepoByFullName,
  generateComparisonReport,
  loadConfig,
  loadStoredLlmConfig,
  saveComparisonReport,
  type ComparisonCandidateInput,
} from '@repo-radar/core'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { getPool } from '@/lib/db'
import { guardAiQuota } from '@/lib/quota-guard'
import { loadProjectContext } from '@/lib/project-context'
import { resolveRepoAccess, sessionUser } from '@/lib/session'

export async function generateComparisonAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')

  const project = String(formData.get('project') ?? '').trim()
  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(project)) redirect('/workbench/integrations?error=compare')

  const pool = getPool()
  await guardAiQuota(pool, Number(currentUser.id))
  const llm = loadConfig().llm ?? (await loadStoredLlmConfig(pool))
  if (!llm) redirect('/settings?llm=missing')

  const access = await resolveRepoAccess(session, currentUser.login)
  if (!access.access) redirect('/workbench/integrations?error=compare-token')

  const latest = await findLatestIntegrationReport(pool, Number(currentUser.id))
  const projectReport = latest?.report.projects.find(
    (item) => item.repo.toLowerCase() === project.toLowerCase(),
  )
  const suggestionRepos = [
    ...new Set(projectReport?.suggestions.map((suggestion) => suggestion.repo) ?? []),
  ]
  if (suggestionRepos.length < 2) redirect('/workbench/integrations?error=compare-candidates')

  let reportId = 0
  try {
    const token = access.access.token
    const context = await loadProjectContext(project, token)
    const candidates: ComparisonCandidateInput[] = []

    for (const repo of suggestionRepos.slice(0, 3)) {
      const candidateContext = await loadProjectContext(repo, token)
      const record = await findRepoByFullName(pool, repo)
      candidates.push({
        repo,
        summary: candidateContext.description || record?.description || '',
        language: candidateContext.language ?? record?.language ?? null,
        topics: candidateContext.topics.length > 0 ? candidateContext.topics : (record?.topics ?? []),
        stars: record?.stars ?? 0,
        readme: candidateContext.readme,
      })
    }

    const report = await generateComparisonReport(
      {
        repo: project,
        description: context.description,
        language: context.language,
        topics: context.topics,
        dependencies: context.dependencies,
        readme: context.readme,
        manifestName: context.manifestName,
        manifest: context.manifest,
      },
      candidates,
      llm,
    )
    reportId = await saveComparisonReport(pool, Number(currentUser.id), project, {
      report,
      generatedAt: new Date().toISOString(),
      model: llm.model,
      providerId: llm.providerId ?? null,
      candidateRepos: candidates.map((candidate) => candidate.repo),
    })
    await addNotification(pool, Number(currentUser.id), {
      kind: 'comparison',
      title: '选型对比已生成',
      body: `${project}：${report.recommendation.repo}`,
      url: `/compare?project=${encodeURIComponent(project)}&report=${reportId}`,
    })
  } catch (error) {
    console.error('[comparison] 生成对比失败：', error)
    const detail = error instanceof Error ? error.message : ''
    redirect(`/workbench/integrations?error=${/JSON|结构不符合/.test(detail) ? 'compare-format' : 'compare'}`)
  }

  revalidatePath('/workbench/integrations')
  revalidatePath('/compare')
  redirect(`/compare?project=${encodeURIComponent(project)}&report=${reportId}`)
}
