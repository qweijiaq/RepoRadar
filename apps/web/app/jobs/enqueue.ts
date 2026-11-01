'use server'

import {
  findWatchIntent,
  isQuotaError,
  loadConfig,
  loadStoredLlmConfig,
  type LlmConfig,
} from '@repo-radar/core'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { getPool } from '@/lib/db'
import { encryptJobToken } from '@/lib/job-secret'
import { resolveRepoAccess, sessionUser } from '@/lib/session'
import { requireAdmin } from '@/lib/admin'
import { enqueueJob } from '@/lib/ai-jobs/runner'

function repoScopeRedirect(reason: string, fallback: string): string {
  return reason === 'need-repo-scope' ? '/repos?error=repo-scope' : fallback
}

async function context(): Promise<{
  userId: number
  login: string
  pool: ReturnType<typeof getPool>
  llm: LlmConfig
}> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')

  const pool = getPool()
  const llm = loadConfig().llm ?? (await loadStoredLlmConfig(pool))
  if (!llm) redirect('/settings?llm=missing')
  return { userId: Number(currentUser.id), login: currentUser.login, pool, llm }
}


function withQuery(path: string, key: string, value: string): string {
  const separator = path.includes('?') ? '&' : '?'
  return `${path}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`
}

async function enqueueAndGo(
  pool: ReturnType<typeof getPool>,
  userId: number,
  kind: Parameters<typeof enqueueJob>[1]['kind'],
  title: string,
  payload: Parameters<typeof enqueueJob>[1]['payload'],
): Promise<never> {
  try {
    const jobId = await enqueueJob(pool, { userId, kind, title, payload })
    revalidatePath('/tasks')
    redirect(`/tasks?job=${jobId}`)
  } catch (error) {
    if (isQuotaError(error)) {
      redirect(`/tasks?quota=${encodeURIComponent(error.message)}`)
    }
    throw error
  }
}

export async function enqueueIntegrationAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')
  const { userId, login, pool } = await context()
  const focus = String(formData.get('focus') ?? '').trim().slice(0, 200) || null
  const access = await resolveRepoAccess(session, login)
  const token = access.access?.token ?? null
  await enqueueAndGo(pool, userId, 'integration', '生成接入建议', {
    focus: focus ?? undefined,
    token: encryptJobToken(token),
    origin: '/integrations',
  })
}

export async function enqueueMaintainerAction(): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')
  const { pool, userId } = await context()

  const access = await resolveRepoAccess(session, currentUser.login)
  if (!access.access) {
    redirect(
      access.reason === 'env-mismatch'
        ? '/maintain?error=env-mismatch'
        : repoScopeRedirect(access.reason, '/maintain?error=need-token'),
    )
  }
  await enqueueAndGo(pool, userId, 'maintainer', '生成维护周报', {
    token: encryptJobToken(access.access.token),
    origin: '/maintain',
  })
}

export async function enqueueIssueAction(): Promise<void> {
  const { pool, userId } = await context()
  await enqueueAndGo(pool, userId, 'issue', '生成技术周报', { origin: '/issue' })
}

export async function enqueueDiscoverabilityAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')
  const { pool, userId } = await context()

  const repo = String(formData.get('repo') ?? '').trim()
  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repo)) redirect('/repos?error=invalid')
  const access = await resolveRepoAccess(session, currentUser.login)
  if (!access.access) redirect(repoScopeRedirect(access.reason, `/repos/${repo}/optimize?error=need-token`))

  await enqueueAndGo(pool, userId, 'discoverability', `曝光优化 · ${repo}`, {
    repo,
    token: encryptJobToken(access.access.token),
    origin: `/repos/${repo}/optimize`,
  })
}

export async function enqueueComparisonAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')
  const { pool, userId } = await context()

  const project = String(formData.get('project') ?? '').trim()
  const returnToRaw = String(formData.get('returnTo') ?? '')
  const returnTo = returnToRaw.startsWith('/') ? returnToRaw : '/integrations'
  const candidates = [
    ...new Set(
      formData
        .getAll('repos')
        .flatMap((value) => String(value).split(','))
        .map((value) => value.trim())
        .filter((value) => /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(value)),
    ),
  ].slice(0, 5)
  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(project)) {
    redirect(withQuery(returnTo, 'error', 'compare'))
  }
  if (candidates.length === 1) {
    redirect(withQuery(returnTo, 'error', 'compare-candidates'))
  }
  const access = await resolveRepoAccess(session, currentUser.login)
  if (!access.access) redirect(repoScopeRedirect(access.reason, withQuery(returnTo, 'error', 'compare-token')))

  await enqueueAndGo(pool, userId, 'comparison', `选型对比 · ${project}`, {
    project,
    ...(candidates.length > 0 ? { candidates } : {}),
    token: encryptJobToken(access.access.token),
    origin: returnTo,
  })
}

export async function enqueueIssuePlanAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')
  const { pool, userId } = await context()

  const repo = String(formData.get('repo') ?? '').trim()
  const issueNumber = Number(formData.get('number'))
  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repo) || !Number.isFinite(issueNumber)) {
    redirect('/maintain?error=issue-invalid')
  }
  const access = await resolveRepoAccess(session, currentUser.login)
  if (!access.access) redirect(repoScopeRedirect(access.reason, '/maintain?error=need-token'))

  await enqueueAndGo(pool, userId, 'issue-plan', `修复方案 · ${repo} #${issueNumber}`, {
    repo,
    issueNumber,
    token: encryptJobToken(access.access.token),
    origin: '/maintain',
  })
}

export async function enqueueUpgradeAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')
  const { pool, userId } = await context()

  const repo = String(formData.get('repo') ?? '').trim()
  const packageName = String(formData.get('package') ?? '').trim()
  const targetVersion = String(formData.get('version') ?? '').trim()
  const currentVersion = String(formData.get('current') ?? '').trim() || null
  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repo)) redirect('/maintain?error=upgrade-invalid')
  if (!/^(@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/.test(packageName)) redirect('/maintain?error=upgrade-invalid')
  if (!/^[A-Za-z0-9._+~-]{1,40}$/.test(targetVersion)) redirect('/maintain?error=upgrade-invalid')

  const access = await resolveRepoAccess(session, currentUser.login)
  if (!access.access) redirect(repoScopeRedirect(access.reason, '/maintain?error=need-token'))

  await enqueueAndGo(pool, userId, 'upgrade', `升级 ${packageName} · ${repo}`, {
    repo,
    packageName,
    targetVersion,
    ...(currentVersion ? { currentVersion } : {}),
    token: encryptJobToken(access.access.token),
    origin: '/maintain',
  })
}

export async function enqueuePatchAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')
  const { pool, userId } = await context()

  const repo = String(formData.get('repo') ?? '').trim()
  const issueNumber = Number(formData.get('number'))
  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repo) || !Number.isFinite(issueNumber) || issueNumber <= 0) {
    redirect('/maintain?error=issue-invalid')
  }
  const access = await resolveRepoAccess(session, currentUser.login)
  if (!access.access) redirect(repoScopeRedirect(access.reason, '/maintain?error=need-token'))

  await enqueueAndGo(pool, userId, 'patch', `修复补丁 · ${repo} #${issueNumber}`, {
    repo,
    issueNumber,
    token: encryptJobToken(access.access.token),
    origin: `/issue-plan?repo=${encodeURIComponent(repo)}&number=${issueNumber}`,
  })
}

export async function enqueueWatchRunAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')
  const { pool, userId } = await context()

  const intentId = Number(formData.get('id'))
  if (!Number.isFinite(intentId)) redirect('/watch?error=not-found')
  const intent = await findWatchIntent(pool, userId, intentId)
  if (!intent) redirect('/watch?error=not-found')

  await enqueueAndGo(pool, userId, 'watch', `关注代理 · ${intent.text.slice(0, 60)}`, {
    intentId,
    origin: '/watch',
  })
}

export async function enqueueDiscoveryAction(formData: FormData): Promise<void> {
  const currentUser = await requireAdmin()
  const session = await auth()
  const { pool, userId } = await context()
  const access = await resolveRepoAccess(session, currentUser.login, { requireRepoScope: false })
  const requested = String(formData.get('topics') ?? '')
    .split(/[,\s]+/)
    .map((topic) => topic.trim())
    .filter(Boolean)
    .slice(0, 8)

  await enqueueAndGo(pool, userId, 'discover', '刷新候选池', {
    ...(requested.length > 0 ? { topics: requested } : {}),
    enrichLimit: 20,
    token: encryptJobToken(access.access?.token ?? null),
    origin: '/settings',
  })
}

export async function enqueueEnrichAction(formData: FormData): Promise<void> {
  await requireAdmin()
  const { pool, userId } = await context()
  const requested = Number.parseInt(String(formData.get('limit') ?? ''), 10)
  const enrichLimit = Number.isFinite(requested) ? Math.min(50, Math.max(1, requested)) : 20
  await enqueueAndGo(pool, userId, 'enrich', '富化候选池', {
    enrichLimit,
    origin: '/settings',
  })
}

export async function enqueueActivitySyncAction(): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')
  const { pool, userId } = await context()

  const access = await resolveRepoAccess(session, currentUser.login, { requireRepoScope: false })
  if (!access.access) redirect('/inbox?error=need-token')

  await enqueueAndGo(pool, userId, 'activity', '同步 GitHub 动态', {
    token: encryptJobToken(access.access.token),
    origin: '/inbox',
  })
}
