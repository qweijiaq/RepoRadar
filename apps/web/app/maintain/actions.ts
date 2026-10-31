'use server'

import {
  addNotification,
  checkProjectDependencies,
  fetchMaintainerSnapshot,
  generateMaintainerReport,
  listFeedStatuses,
  listUserProjects,
  loadConfig,
  loadStoredLlmConfig,
  saveMaintainerReport,
  type MaintainerProjectInput,
} from '@repo-radar/core'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { getPool } from '@/lib/db'
import { loadProjectContext } from '@/lib/project-context'
import { resolveRepoAccess, sessionUser } from '@/lib/session'

const MAX_PROJECTS = 3

export async function generateMaintainerAction(): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')

  const pool = getPool()
  const llm = loadConfig().llm ?? (await loadStoredLlmConfig(pool))
  if (!llm) redirect('/settings?llm=missing')

  const access = await resolveRepoAccess(session, currentUser.login)
  if (!access.access) {
    redirect(access.reason === 'env-mismatch' ? '/maintain?error=env-mismatch' : '/maintain?error=need-token')
  }

  const userId = Number(currentUser.id)
  const completed = new Set((await listFeedStatuses(pool, userId)).map((status) => status.key))
  const projects = await listUserProjects(pool, userId)
  let selected = projects.filter((project) => project.active)
  if (selected.length === 0) selected = projects.filter((project) => project.source === 'owned')
  selected = selected.slice(0, MAX_PROJECTS)
  if (selected.length === 0) redirect('/maintain?error=no-projects')

  let reportId = 0
  try {
    const token = access.access.token
    const inputs: MaintainerProjectInput[] = []
    const warnings: string[] = []

    for (const project of selected) {
      const context = await loadProjectContext(project.repoFullName, token)
      const [snapshot, dependencies] = await Promise.all([
        fetchMaintainerSnapshot(token, project.repoFullName),
        checkProjectDependencies(context.manifestName, context.manifest, {
          token,
          limit: 12,
          lockfile:
            context.lockfileName && context.lockfile
              ? { name: context.lockfileName, content: context.lockfile }
              : null,
        }),
      ])
      warnings.push(...snapshot.warnings)
      if (dependencies.supported && dependencies.note) warnings.push(`${project.repoFullName}：${dependencies.note}`)

      inputs.push({
        repo: project.repoFullName,
        description: context.description,
        language: context.language,
        topics: context.topics,
        readme: context.readme,
        manifestName: context.manifestName,
        manifest: context.manifest,
        dependencies: dependencies.items.filter(
          (dependency) =>
            !completed.has(
              `dependency:${project.repoFullName}:${dependency.name}:${dependency.latest ?? 'unknown'}`,
            ),
        ),        signals: {
          ...snapshot.signals,
          hasTests:
            snapshot.signals.hasTests ||
            /"(test|vitest|jest|pytest)"\s*:/.test(context.manifest ?? '') ||
            /pytest|vitest|jest/i.test(context.manifest ?? ''),
        },
        items: snapshot.items.filter(
          (item) => !completed.has(`maintainer:${project.repoFullName}:${item.kind}:${item.number}`),
        ),
      })
    }

    const report = await generateMaintainerReport(inputs, llm)
    reportId = await saveMaintainerReport(pool, userId, {
      report,
      usedProjects: selected.map((project) => project.repoFullName),
      warnings: [...new Set(warnings)],
      generatedAt: new Date().toISOString(),
      model: llm.model,
      providerId: llm.providerId ?? null,
    })
    await addNotification(pool, userId, {
      kind: 'maintainer',
      title: '维护周报已生成',
      body: report.projects.map((project) => project.repo).join('、'),
      url: `/maintain?report=${reportId}`,
    })
  } catch (error) {
    console.error('[maintainer] 生成维护周报失败：', error)
    const detail = error instanceof Error ? error.message : ''
    const code = /JSON|结构不符合/.test(detail) ? 'format' : 'generate'
    redirect(`/maintain?error=${code}`)
  }

  revalidatePath('/maintain')
  redirect(`/maintain?report=${reportId}`)
}
