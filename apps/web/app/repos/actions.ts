'use server'

import {
  addNotification,
  createRepository,
  deleteRepository,
  fetchReadme,
  findDiscoverabilityReportById,
  findLatestDiscoverabilityReport,
  generateDiscoverabilityReport,
  loadConfig,
  loadStoredLlmConfig,
  removeUserProject,
  renameUserProject,
  runBatch,
  saveDiscoverabilityReport,
  setUserProjectActive,
  updateRepository,
  updateRepositoryTopics,
  upsertUserProject,
  validateRepoName,
  type UpdateRepoInput,
} from '@repo-radar/core'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { getPool } from '@/lib/db'
import { guardAiQuota } from '@/lib/quota-guard'
import { fetchGitHubRepo } from '@/lib/project-context'
import { resolveRepoAccess, sessionUser } from '@/lib/session'
import { initialRepoActionState, type RepoActionResult } from './types'

const MAX_BATCH = 20
const MAX_CREATE = 10

function failure(message: string, details: string[] = []): RepoActionResult {
  return { ...initialRepoActionState, status: 'error', message, details }
}

function selectedRepos(formData: FormData): string[] {
  const seen = new Set<string>()
  for (const value of formData.getAll('repos')) {
    const repo = String(value).trim()
    if (/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repo)) seen.add(repo)
  }
  return [...seen]
}

function finish(message: string, results: Array<{ item: string; value?: unknown; error?: string }>): RepoActionResult {
  const failed = results.filter((result) => result.error)
  const ok = results.length - failed.length
  if (failed.length === 0) return { status: 'success', message: `${message} ${ok} 个仓库`, details: [] }

  return {
    status: ok > 0 ? 'partial' : 'error',
    message: `${message} ${ok} 个，失败 ${failed.length} 个`,
    details: failed.map((result) => `${result.item}：${result.error}`),
  }
}

export async function createReposAction(
  _previous: RepoActionResult,
  formData: FormData,
): Promise<RepoActionResult> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) return failure('登录状态已失效，请重新登录')
  const access = await resolveRepoAccess(session, currentUser.login)
  if (!access.access) {
    return failure(
      access.reason === 'env-mismatch'
        ? 'GITHUB_TOKEN 与当前登录账户不一致，仓库管理已停用'
        : '需要 GitHub 授权后才能新建仓库',
    )
  }
  const token = access.access.token

  const names = [
    ...new Set(
      String(formData.get('names') ?? '')
        .split(/[\s,，]+/)
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  ]
  if (names.length === 0) return failure('请至少填写一个仓库名')
  if (names.length > MAX_CREATE) return failure(`一次最多新建 ${MAX_CREATE} 个仓库`)

  const details: string[] = []
  const valid: string[] = []
  for (const name of names) {
    try {
      valid.push(validateRepoName(name))
    } catch (error) {
      details.push(`${name}：${error instanceof Error ? error.message : '仓库名不合法'}`)
    }
  }
  if (valid.length === 0) return failure('没有合法的仓库名', details)

  const description = String(formData.get('description') ?? '').trim().slice(0, 350)
  const isPrivate = String(formData.get('visibility') ?? 'public') === 'private'
  const autoInit = formData.get('autoInit') === '1'
  const gitignoreTemplate = String(formData.get('gitignoreTemplate') ?? '')
  const licenseTemplate = String(formData.get('licenseTemplate') ?? '')

  const results = await runBatch(valid, 3, (name) =>
    createRepository(token, {
      name,
      description,
      private: isPrivate,
      autoInit,
      ...(gitignoreTemplate ? { gitignoreTemplate } : {}),
      ...(licenseTemplate ? { licenseTemplate } : {}),
    }),
  )

  const pool = getPool()
  for (const result of results) {
    if (!result.value) continue
    try {
      await upsertUserProject(pool, Number(currentUser.id), result.value.fullName, {
        source: 'owned',
        active: true,
        lastPushedAt: result.value.pushedAt,
      })
    } catch (error) {
      console.error('[repos] 记录新仓库失败：', error)
    }
  }

  revalidatePath('/repos')
  revalidatePath('/integrations')
  const summary = finish('已创建', results)
  return {
    ...summary,
    details: [...details, ...summary.details],
    status: details.length > 0 && summary.status === 'success' ? 'partial' : summary.status,
  }
}

export async function updateReposAction(
  _previous: RepoActionResult,
  formData: FormData,
): Promise<RepoActionResult> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) return failure('登录状态已失效，请重新登录')
  const access = await resolveRepoAccess(session, currentUser.login)
  if (!access.access) {
    return failure(
      access.reason === 'env-mismatch'
        ? 'GITHUB_TOKEN 与当前登录账户不一致，仓库管理已停用'
        : '需要 GitHub 授权后才能修改仓库',
    )
  }
  const token = access.access.token

  const single = String(formData.get('mode') ?? '') === 'single'
  const singleRepo = String(formData.get('repo') ?? '').trim()
  const targets = single ? [singleRepo] : selectedRepos(formData)
  const validTargets = targets.filter((repo) => /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repo))
  if (validTargets.length === 0) return failure('请先选择要修改的仓库')
  if (validTargets.length > MAX_BATCH) return failure(`一次最多修改 ${MAX_BATCH} 个仓库`)

  const name = single ? String(formData.get('name') ?? '').trim() : ''
  const description = String(formData.get('description') ?? '')
  const visibility = String(formData.get('visibility') ?? 'keep')
  const archive = String(formData.get('archived') ?? 'keep')
  const clearDescription = formData.get('clearDescription') === '1'

  if (single && !name) return failure('仓库名不能为空')
  if (single && !/^[A-Za-z0-9._-]+$/.test(name)) return failure('仓库名只能包含字母、数字、点、下划线和连字符')
  if (!single && !description.trim() && !clearDescription && visibility === 'keep' && archive === 'keep') {
    return failure('没有选择任何修改项')
  }

  function patchFor(): UpdateRepoInput {
    const patch: UpdateRepoInput = {}
    if (single) {
      patch.name = name
      patch.description = description
    } else if (description.trim() || clearDescription) {
      patch.description = clearDescription ? '' : description
    }
    if (visibility === 'private') patch.private = true
    if (visibility === 'public') patch.private = false
    if (archive === 'archive') patch.archived = true
    if (archive === 'unarchive') patch.archived = false
    return patch
  }

  const patch = patchFor()
  if (Object.keys(patch).length === 0) return failure('没有选择任何修改项')

  const results = await runBatch(validTargets, 3, (repo) => updateRepository(token, repo, patch))
  const pool = getPool()
  for (const result of results) {
    if (!result.value) continue
    try {
      if (result.value.fullName.toLowerCase() !== result.item.toLowerCase()) {
        await renameUserProject(pool, Number(currentUser.id), result.item, result.value.fullName)
      }
      if (result.value.archived) {
        await setUserProjectActive(pool, Number(currentUser.id), result.value.fullName, false)
      }
    } catch (error) {
      console.error('[repos] 同步仓库记录失败：', error)
    }
  }

  revalidatePath('/repos')
  revalidatePath('/integrations')
  return finish('已更新', results)
}

export async function deleteReposAction(
  _previous: RepoActionResult,
  formData: FormData,
): Promise<RepoActionResult> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) return failure('登录状态已失效，请重新登录')
  const access = await resolveRepoAccess(session, currentUser.login)
  if (!access.access) {
    return failure(
      access.reason === 'env-mismatch'
        ? 'GITHUB_TOKEN 与当前登录账户不一致，仓库管理已停用'
        : '需要 GitHub 授权后才能删除仓库',
    )
  }
  const token = access.access.token
  if (formData.get('confirm') !== 'yes') return failure('请先确认删除')

  const targets = selectedRepos(formData)
  if (targets.length === 0) return failure('请先选择要删除的仓库')
  if (targets.length > MAX_BATCH) return failure(`一次最多删除 ${MAX_BATCH} 个仓库`)

  const results = await runBatch<string, void>(targets, 3, (repo) => deleteRepository(token, repo))
  const pool = getPool()
  for (const result of results) {
    if (result.error) continue
    try {
      await removeUserProject(pool, Number(currentUser.id), result.item)
    } catch (error) {
      console.error('[repos] 清理仓库记录失败：', error)
    }
  }

  revalidatePath('/repos')
  revalidatePath('/integrations')
  return finish('已删除', results)
}

function validFullName(repo: string): boolean {
  return /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repo)
}

export async function generateDiscoverabilityAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')

  const repo = String(formData.get('repo') ?? '').trim()
  if (!validFullName(repo)) redirect('/repos?error=invalid')

  const access = await resolveRepoAccess(session, currentUser.login)
  if (!access.access) {
    redirect(`/repos/${repo}/optimize?error=need-token`)
  }

  const pool = getPool()
  await guardAiQuota(pool, Number(currentUser.id))
  const llm = loadConfig().llm ?? (await loadStoredLlmConfig(pool))
  if (!llm) redirect('/settings?llm=missing')

  const token = access.access.token
  const fetched = await fetchGitHubRepo(repo, token)
  if (!fetched) redirect(`/repos/${repo}/optimize?error=not-found`)
  if (fetched.owner.toLowerCase() !== currentUser.login.toLowerCase()) {
    redirect(`/repos/${repo}/optimize?error=not-owned`)
  }

  let reportId = 0
  try {
    const readme = await fetchReadme(repo, token)
    const report = await generateDiscoverabilityReport(
      {
        repo,
        description: fetched.description ?? '',
        topics: fetched.topics,
        readme,
        language: fetched.language,
        stars: fetched.stars,
        forks: fetched.forks,
        openIssues: fetched.openIssues,
        homepage: fetched.homepage,
        license: fetched.license,
        pushedAt: fetched.pushedAt,
      },
      llm,
    )
    reportId = await saveDiscoverabilityReport(pool, Number(currentUser.id), {
      report,
      repo,
      generatedAt: new Date().toISOString(),
      model: llm.model,
      providerId: llm.providerId ?? null,
    })
    await addNotification(pool, Number(currentUser.id), {
      kind: 'discoverability',
      title: '曝光优化报告已生成',
      body: repo,
      url: `/repos/${repo}/optimize?report=${reportId}`,
    })
  } catch (error) {
    console.error('[discoverability] 生成失败：', error)
    const detail = error instanceof Error ? error.message : ''
    redirect(`/repos/${repo}/optimize?error=${/JSON|结构不符合/.test(detail) ? 'format' : 'generate'}`)
  }

  revalidatePath(`/repos/${repo}/optimize`)
  redirect(`/repos/${repo}/optimize?report=${reportId}`)
}

export async function applyDiscoverabilityAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')

  const repo = String(formData.get('repo') ?? '').trim()
  if (!validFullName(repo)) redirect('/repos?error=invalid')

  const access = await resolveRepoAccess(session, currentUser.login)
  if (!access.access) redirect(`/repos/${repo}/optimize?error=need-token`)

  const pool = getPool()
  const requestedReport = Number(formData.get('report'))
  const latest =
    Number.isFinite(requestedReport) && requestedReport > 0
      ? await findDiscoverabilityReportById(pool, Number(currentUser.id), requestedReport)
      : await findLatestDiscoverabilityReport(pool, Number(currentUser.id), repo)
  if (!latest) redirect(`/repos/${repo}/optimize?error=no-report`)

  try {
    await updateRepository(access.access.token, repo, {
      description: latest.report.suggestedDescription,
    })
    if (latest.report.suggestedTopics.length > 0) {
      await updateRepositoryTopics(access.access.token, repo, latest.report.suggestedTopics)
    }
  } catch (error) {
    console.error('[discoverability] 应用建议失败：', error)
    redirect(`/repos/${repo}/optimize?error=apply`)
  }

  revalidatePath('/repos')
  revalidatePath(`/repos/${repo}/optimize`)
  redirect(`/repos/${repo}/optimize?applied=1`)
}
