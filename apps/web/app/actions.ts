'use server'

import {
  GITHUB_DELETE_REPO_SCOPES,
  GITHUB_REPO_SCOPES,
  addCollectionItem,
  addSubscription,
  chatCompletion,
  clearIntegrationOutcome,
  clearMailConfig,
  clearLlmPrices,
  clearOpsConfig,
  clearQuotaConfig,
  clearRetentionConfig,
  clearStoredLlmConfig,
  createCollection,
  deleteCollection,
  deleteUserAccount,
  findCollectionAccess,
  findEnrichedRepos,
  findLlmProvider,
  findRepoByFullName,
  findTeamForUser,
  saveRepoProfile,
  repoProfileSourceHash,
  loadRepoProfiles,
  generateRepoProfile,
  saveInferredTopics,
  inferRepoTopics,
  invalidateFeedSnapshot,
  fetchReadme,
  generateTrendingCopy,
  loadDailyRanking,
  saveTrendingCopy,
  selectTrendingItems,
  trendingDateKey,
  evaluateSetupAccess,
  isValidGithubClientId,
  isValidGithubClientSecret,
  isValidSubscriptionValue,
  isNotificationCategory,
  loadConfig,
  loadFeedback,
  loadMailStatus,
  loadStoredLlmConfig,
  saveLlmPrices,
  markNotificationRead,
  markNotificationsRead,
  markNotificationsReadMatching,
  resolveBaseUrlStatus,
  resolveMailConfig,
  resolveNotificationEmail,
  runRetentionIfDue,
  removeCollectionItem,
  removeSubscription,
  removeUserProject,
  revokeRadarSnapshot,
  saveBaseUrl,
  saveMailConfig,
  saveNotificationEmail,
  saveOpsConfig,
  saveQuotaConfig,
  saveRetentionConfig,
  saveNotificationPrefs,
  saveStoredLlmConfig,
  setCollectionPublic,
  setFeedback,
  setIntegrationOutcome,
  setUserProjectActive,
  isValidMailAddress,
  canManageTeam,
  canWriteTeam,
  upsertRepo,
  upsertUserProject,
  type SubscriptionKind,
  getPool,
  fetchGitHubRepo,
  loadProjectContext,
  sendMail,
} from '@repo-radar/core'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth, signIn, signOut } from '@/auth'
import { clearGithubCredentials, resolveGithubCredentials, saveGithubCredentials } from '@/lib/oauth-config'
import {
  clearGithubWebhookSecret,
  isValidWebhookSecret,
  resolveGithubWebhookSecret,
  saveGithubWebhookSecret,
} from '@/lib/webhook-config'
import { adminLogins, isAdminUser, requireAdmin } from '@/lib/admin'
import { assertWritable } from '@/lib/readonly'
import { sessionAccessToken, sessionUser } from '@/lib/session'
import { rebuildProfile, syncUserTaste } from '@/lib/sync'
import { findUserById, savePrefs } from '@/lib/users'

export async function signInGithubAction(formData?: FormData): Promise<void> {
  const requested = String(formData?.get('redirectTo') ?? '')
  const redirectTo = requested.startsWith('/') ? requested : '/feed'
  await signIn('github', { redirectTo })
}

export async function signInGithubRepoAction(formData?: FormData): Promise<void> {
  const requested = String(formData?.get('redirectTo') ?? '')
  const redirectTo = requested.startsWith('/') ? requested : '/repos'
  await signIn('github', { redirectTo }, { scope: GITHUB_REPO_SCOPES })
}

export async function signInGithubDeleteReposAction(formData?: FormData): Promise<void> {
  const requested = String(formData?.get('redirectTo') ?? '')
  const redirectTo = requested.startsWith('/') ? requested : '/repos'
  await signIn('github', { redirectTo }, { scope: GITHUB_DELETE_REPO_SCOPES })
}

export async function signInDevAction(): Promise<void> {
  await signIn('dev', { redirectTo: '/feed' })
}

/** 演示模式：以 seed 出来的 demo-radar 身份进入，不读取任何真实 GitHub 数据。 */
export async function signInDemoAction(): Promise<void> {
  await signIn('demo-radar', { redirectTo: '/feed' })
}

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: '/' })
}

export async function testLlmConnectionAction(): Promise<void> {
  const admin = await requireAdmin()
  const pool = getPool()
  const llm = loadConfig().llm ?? (await loadStoredLlmConfig(pool))
  if (!llm) redirect('/settings?test=llm-missing#ai')

  let failure: string | null = null
  try {
    const reply = await chatCompletion(
      llm,
      [{ role: 'user', content: '只回复 OK 两个字母，用于连接测试。' }],
      { maxTokens: 16, temperature: 0 },
    )
    console.log(`[settings] LLM connection test by ${admin.login}: ${reply.trim().slice(0, 40)}`)
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
    console.error('[settings] LLM connection test failed:', failure)
  }
  if (failure) {
    const status = /\b(4\d{2}|5\d{2})\b/.exec(failure)?.[1]
    redirect(`/settings?test=llm-fail${status ? `&code=${status}` : ''}#ai`)
  }
  redirect('/settings?test=llm-ok#ai')
}

export async function testMailAction(): Promise<void> {
  const admin = await requireAdmin()
  const pool = getPool()
  const mail = await resolveMailConfig(pool)
  if (!mail) redirect('/settings?test=mail-missing#mail')
  const user = await findUserById(Number(admin.id))
  const to = user ? resolveNotificationEmail(user) : null
  if (!to) redirect('/settings?test=mail-no-address#mail')

  let failure: string | null = null
  try {
    await sendMail(mail, {
      to,
      subject: '[RepoRadar] 邮件通道测试',
      text: `这是一封来自 RepoRadar 的测试邮件。\n\n如果你收到它，说明 SMTP 配置和通知邮箱都可以正常工作。\n\n发送时间：${new Date().toLocaleString('zh-CN')}`,
    })
    console.log(`[settings] test mail sent by ${admin.login}`)
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
    console.error('[settings] test mail failed:', failure)
  }
  if (failure) redirect('/settings?test=mail-fail#mail')
  redirect('/settings?test=mail-ok#mail')
}

function parseList(value: FormDataEntryValue | null): string[] {
  return String(value ?? '')
    .split(/[,，\s]+/)
    .map((item) => item.trim().replace(/^#/, ''))
    .filter(Boolean)
}

export async function savePrefsAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')
  assertWritable(currentUser.login)

  await savePrefs(Number(currentUser.id), {
    excludedTopics: parseList(formData.get('excludedTopics')),
    excludedLanguages: parseList(formData.get('excludedLanguages')),
  })
  await rebuildProfile(Number(currentUser.id))
  await invalidateFeedSnapshot(getPool(), Number(currentUser.id))
  revalidatePath('/settings')
  revalidatePath('/feed')
}

export async function resyncStarsAction(): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')
  assertWritable(currentUser.login)

  const token = await sessionAccessToken(session)
  let failed = false
  if (token) {
    try {
      await syncUserTaste(Number(currentUser.id), currentUser.login, token)
      await invalidateFeedSnapshot(getPool(), Number(currentUser.id))
    } catch (error) {
      failed = true
      console.error('[settings] 重新同步画像失败：', error)
    }
  }
  revalidatePath('/settings')
  revalidatePath('/feed')
  redirect(failed ? '/settings?sync=error' : '/settings?sync=ok')
}

export async function loadDemoTasteAction(): Promise<void> {
  if (process.env.AUTH_DEV_MODE !== '1' || process.env.NODE_ENV === 'production') return

  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')
  assertWritable(currentUser.login)

  await getPool().query(
    `INSERT INTO user_stars (user_id, repo_full_name, starred_at)
     SELECT $1, full_name, now() FROM (
       SELECT full_name FROM repos
       WHERE enriched_at IS NOT NULL
       ORDER BY quality_score DESC NULLS LAST
       LIMIT 30
     ) picked
     ON CONFLICT (user_id, repo_full_name) DO NOTHING`,
    [Number(currentUser.id)],
  )
  await rebuildProfile(Number(currentUser.id))
  await invalidateFeedSnapshot(getPool(), Number(currentUser.id))
  revalidatePath('/settings')
  revalidatePath('/feed')
}

export async function submitFeedbackAction(formData: FormData): Promise<void> {  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')
  assertWritable(currentUser.login)

  const repoFullName = String(formData.get('repo') ?? '').trim()
  if (!repoFullName) return

  const kind = String(formData.get('kind') ?? '') === 'hide' ? 'hide' : 'save'
  const userId = Number(currentUser.id)
  const pool = getPool()
  const current = await loadFeedback(pool, userId)
  // 再次点击同一个按钮表示取消
  await setFeedback(pool, userId, repoFullName, current.get(repoFullName) === kind ? null : kind)
  await invalidateFeedSnapshot(pool, userId)
  revalidatePath('/feed')
}

const SUBSCRIPTION_KIND_VALUES = new Set<SubscriptionKind>(['topic', 'language', 'author', 'release'])

function parseSubscriptionKind(value: FormDataEntryValue | null): SubscriptionKind | null {
  const kind = String(value ?? '') as SubscriptionKind
  return SUBSCRIPTION_KIND_VALUES.has(kind) ? kind : null
}

export async function addSubscriptionAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')
  assertWritable(currentUser.login)

  const kind = parseSubscriptionKind(formData.get('kind'))
  const value = String(formData.get('value') ?? '').trim()
  if (!kind || !isValidSubscriptionValue(kind, value)) redirect('/settings?sub=invalid')

  await addSubscription(getPool(), Number(currentUser.id), kind, value)
  await invalidateFeedSnapshot(getPool(), Number(currentUser.id))
  revalidatePath('/settings')
  revalidatePath('/feed')
}

export async function removeSubscriptionAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')
  assertWritable(currentUser.login)

  const kind = parseSubscriptionKind(formData.get('kind'))
  const value = String(formData.get('value') ?? '').trim()
  if (!kind || !value) return

  await removeSubscription(getPool(), Number(currentUser.id), kind, value)
  await invalidateFeedSnapshot(getPool(), Number(currentUser.id))
  revalidatePath('/settings')
  revalidatePath('/feed')
}

export async function saveOAuthConfigAction(formData: FormData): Promise<void> {
  const existing = await resolveGithubCredentials()
  if (existing?.source === 'env') redirect('/setup')

  if (existing) {
    await requireAdmin()
  } else {
    const headerList = await headers()
    const access = evaluateSetupAccess({
      host: headerList.get('host'),
      setupToken: process.env.SETUP_TOKEN,
      submittedToken: String(formData.get('setupToken') ?? ''),
    })
    if (access === 'locked') redirect('/setup?error=locked')
    if (access === 'invalid-token') redirect('/setup?error=token')
  }

  const session = await auth()
  const currentUser = sessionUser(session)

  const clientId = String(formData.get('clientId') ?? '').trim()
  const submittedSecret = String(formData.get('clientSecret') ?? '').trim()
  // 设置页更新时允许留空 Secret，表示沿用当前值
  const clientSecret = submittedSecret || (existing?.source === 'database' ? existing.clientSecret : '')

  if (!isValidGithubClientId(clientId) || !isValidGithubClientSecret(clientSecret)) {
    redirect(currentUser ? '/settings?oauth=invalid' : '/setup?error=invalid')
  }

  await saveGithubCredentials(clientId, clientSecret)
  revalidatePath('/setup')
  revalidatePath('/login')
  revalidatePath('/settings')
  redirect(existing ? '/settings?oauth=saved' : '/login?configured=1')
}

export async function clearOAuthConfigAction(): Promise<void> {
  await requireAdmin()

  const existing = await resolveGithubCredentials()
  if (existing?.source === 'env') redirect('/settings')

  await clearGithubCredentials()
  revalidatePath('/setup')
  revalidatePath('/login')
  revalidatePath('/settings')
  redirect('/settings?oauth=cleared')
}

export async function saveLlmConfigAction(formData: FormData): Promise<void> {
  await requireAdmin()
  if (process.env.LLM_API_KEY?.trim()) redirect('/settings?llm=env')

  const providerId = String(formData.get('providerId') ?? '').trim()
  const model = String(formData.get('model') ?? '').trim()
  const baseUrl = String(formData.get('baseUrl') ?? '').trim()
  const embeddingModel = String(formData.get('embeddingModel') ?? '').trim()
  const submittedKey = String(formData.get('apiKey') ?? '').trim()

  const provider = findLlmProvider(providerId)
  if (!provider || !model) redirect('/settings?llm=invalid')
  if (baseUrl && !/^https?:\/\//i.test(baseUrl)) redirect('/settings?llm=invalid')

  let apiKey = submittedKey
  if (!apiKey) {
    const existing = await loadStoredLlmConfig(getPool())
    if (!existing || existing.providerId !== providerId) redirect('/settings?llm=key-required')
    apiKey = existing.apiKey
  }
  if (apiKey.length < 8) redirect('/settings?llm=invalid')

  await saveStoredLlmConfig(getPool(), {
    providerId,
    model,
    apiKey,
    ...(baseUrl ? { baseUrl } : {}),
    embeddingModel,
  })
  revalidatePath('/settings')
  redirect('/settings?llm=saved')
}

export async function clearLlmConfigAction(): Promise<void> {
  await requireAdmin()
  if (process.env.LLM_API_KEY?.trim()) redirect('/settings?llm=env')

  await clearStoredLlmConfig(getPool())
  revalidatePath('/settings')
  redirect('/settings?llm=cleared')
}

export async function inferRepoTopicsAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')
  assertWritable(currentUser.login)

  const repo = String(formData.get('repo') ?? '').trim()
  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repo)) redirect('/feed')

  const pool = getPool()
  const record = await findRepoByFullName(pool, repo)
  if (!record) redirect(`/r/${repo}`)

  const llm = loadConfig().llm ?? (await loadStoredLlmConfig(pool))
  if (!llm) redirect(`/r/${repo}?topics=llm`)

  const token = await sessionAccessToken(session)
  const readme = token ? await fetchReadme(repo, token).catch(() => null) : null
  const topics = await inferRepoTopics(
    {
      repo,
      summary: record.summary,
      description: record.description,
      language: record.language,
      existingTopics: record.topics,
      readme,
    },
    llm,
  )
  await saveInferredTopics(pool, repo, topics)
  revalidatePath(`/r/${repo}`)
  redirect(`/r/${repo}?topics=1`)
}

export async function generateMissingProfilesAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')
  assertWritable(currentUser.login)

  const target = formData.get('target') === 'daily' ? 'daily' : 'share'
  const back = target === 'daily' ? '/daily' : '/share/trending'
  const token = await sessionAccessToken(session)
  if (!token) redirect(`${back}?error=need-token`)

  const pool = getPool()
  const llm = loadConfig().llm ?? (await loadStoredLlmConfig(pool))
  if (!llm) redirect(`${back}?error=llm`)

  const items =
    target === 'daily'
      ? (await loadDailyRanking(pool, 10)).items
      : selectTrendingItems(await findEnrichedRepos(pool, 500), 10)
  const profiles = await loadRepoProfiles(pool, items.map((item) => item.fullName))
  const missing = items.filter((item) => !profiles.has(item.fullName)).slice(0, 3)

  for (const item of missing) {
    try {
      const context = await loadProjectContext(item.fullName, token)
      if (!context.readme && !context.manifest) continue
      const profile = await generateRepoProfile(
        {
          repo: item.fullName,
          description: context.description,
          readme: context.readme,
          manifestName: context.manifestName,
          manifest: context.manifest,
          topics: item.topics,
          language: item.language,
        },
        llm,
      )
      await saveRepoProfile(pool, item.fullName, profile, {
        model: llm.model,
        sourceHash: repoProfileSourceHash(context.readme, context.manifest),
      })
    } catch (error) {
      console.error(`[profiles] 生成 ${item.fullName} 失败：`, error)
    }
  }

  revalidatePath('/share/trending')
  revalidatePath('/daily')
  redirect(`${back}?profiles=1`)
}

export async function generateTrendingPostAction(): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')
  assertWritable(currentUser.login)

  const pool = getPool()
  const llm = loadConfig().llm ?? (await loadStoredLlmConfig(pool))
  if (!llm) redirect('/share/trending?error=llm')

  const items = selectTrendingItems(await findEnrichedRepos(pool, 500), 10)
  if (items.length === 0) redirect('/share/trending?error=empty')

  const copy = await generateTrendingCopy(items, llm)
  await saveTrendingCopy(pool, trendingDateKey(), copy, {
    model: llm.model,
    generatedAt: new Date().toISOString(),
  })
  revalidatePath('/share/trending')
  redirect('/share/trending?generated=1')
}

export async function generateDailyCopyAction(): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')
  assertWritable(currentUser.login)

  const pool = getPool()
  const llm = loadConfig().llm ?? (await loadStoredLlmConfig(pool))
  if (!llm) redirect('/daily?error=llm')

  const ranking = await loadDailyRanking(pool, 10)
  if (ranking.items.length === 0) redirect('/daily?error=empty')

  const copy = await generateTrendingCopy(ranking.items, llm)
  await saveTrendingCopy(
    pool,
    ranking.dateKey,
    copy,
    { model: llm.model, generatedAt: new Date().toISOString() },
    'daily',
  )
  revalidatePath('/daily')
  redirect('/daily?generated=1')
}

export async function markInboxReadAction(): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')
  assertWritable(currentUser.login)

  await markNotificationsRead(getPool(), Number(currentUser.id))
  revalidatePath('/inbox')
  revalidatePath('/', 'layout')
  redirect('/inbox')
}

export async function markSelectedNotificationsReadAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')
  assertWritable(currentUser.login)

  const ids = [
    ...new Set(
      formData
        .getAll('ids')
        .map((value) => Number(value))
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  ]
  for (const id of ids) {
    await markNotificationRead(getPool(), Number(currentUser.id), id)
  }
  const requested = String(formData.get('returnTo') ?? '')
  revalidatePath('/inbox')
  revalidatePath('/', 'layout')
  redirect(requested.startsWith('/inbox') ? requested : '/inbox')
}

export async function markInboxCategoryReadAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')
  assertWritable(currentUser.login)

  const category = String(formData.get('category') ?? 'all')
  const aiKinds = ['integration', 'maintainer', 'watch', 'comparison', 'discoverability', 'issue-plan']
  const filter =
    category === 'github'
      ? { prefixes: ['github-'] }
      : category === 'ai'
        ? { kinds: aiKinds }
        : category === 'release'
          ? { kinds: ['release'] }
          : category === 'system'
            ? { excludePrefixes: ['github-'], excludeKinds: [...aiKinds, 'release'] }
            : {}

  await markNotificationsReadMatching(getPool(), Number(currentUser.id), filter)
  const requested = String(formData.get('returnTo') ?? '')
  revalidatePath('/inbox')
  revalidatePath('/', 'layout')
  redirect(requested.startsWith('/inbox') ? requested : '/inbox')
}

export async function createCollectionAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')
  assertWritable(currentUser.login)

  const name = String(formData.get('name') ?? '').trim()
  if (!name) redirect('/feed?tab=collections&error=name')
  const description = String(formData.get('description') ?? '').trim()
  const requestedTeam = Number(formData.get('teamId'))
  const teamId = Number.isFinite(requestedTeam) && requestedTeam > 0 ? requestedTeam : null
  if (teamId) {
    const team = await findTeamForUser(getPool(), Number(currentUser.id), teamId)
    if (!team || !canWriteTeam(team.role)) redirect('/feed?tab=collections&error=team')
  }

  const id = await createCollection(
    getPool(),
    Number(currentUser.id),
    name.slice(0, 80),
    description ? description.slice(0, 300) : null,
    teamId,
  )
  revalidatePath('/feed?tab=collections')
  redirect(`/collections/${id}`)
}

async function editableCollection(collectionId: number, userId: number) {
  const collection = await findCollectionAccess(getPool(), userId, collectionId)
  return collection && collection.access !== 'read' ? collection : null
}

async function deletableCollection(collectionId: number, userId: number) {
  const collection = await findCollectionAccess(getPool(), userId, collectionId)
  if (!collection) return null
  if (collection.access === 'owner') return collection
  if (collection.teamRole && canManageTeam(collection.teamRole)) return collection
  return null
}

function safeReturnTo(value: FormDataEntryValue | null, fallback: string): string {
  const path = String(value ?? '')
  return path.startsWith('/') ? path : fallback
}

export async function addToCollectionAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')
  assertWritable(currentUser.login)

  const collectionId = Number(formData.get('collectionId'))
  const repoFullName = String(formData.get('repo') ?? '').trim()
  const note = String(formData.get('note') ?? '').trim()
  const returnTo = safeReturnTo(formData.get('returnTo'), '/feed?tab=collections')

  if (repoFullName && (await editableCollection(collectionId, Number(currentUser.id)))) {
    await addCollectionItem(getPool(), collectionId, repoFullName, note || null)
    revalidatePath(`/collections/${collectionId}`)
  }
  redirect(returnTo)
}

export async function removeCollectionItemAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')
  assertWritable(currentUser.login)

  const collectionId = Number(formData.get('collectionId'))
  const repoFullName = String(formData.get('repo') ?? '').trim()
  const returnTo = safeReturnTo(formData.get('returnTo'), `/collections/${collectionId}`)

  if (repoFullName && (await editableCollection(collectionId, Number(currentUser.id)))) {
    await removeCollectionItem(getPool(), collectionId, repoFullName)
    revalidatePath(`/collections/${collectionId}`)
  }
  redirect(returnTo)
}

export async function toggleCollectionPublicAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')
  assertWritable(currentUser.login)

  const collectionId = Number(formData.get('collectionId'))
  const collection = await editableCollection(collectionId, Number(currentUser.id))
  if (collection) {
    await setCollectionPublic(getPool(), collectionId, !collection.isPublic)
    revalidatePath(`/collections/${collectionId}`)
  }
  redirect(`/collections/${collectionId}`)
}

export async function deleteCollectionAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')
  assertWritable(currentUser.login)

  const collectionId = Number(formData.get('collectionId'))
  if (await deletableCollection(collectionId, Number(currentUser.id))) {
    await deleteCollection(getPool(), collectionId)
    revalidatePath('/feed?tab=collections')
  }
  redirect('/feed?tab=collections')
}

export async function toggleProjectActiveAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')
  assertWritable(currentUser.login)

  const repoFullName = String(formData.get('repo') ?? '').trim()
  const active = String(formData.get('active') ?? '') === '1'
  if (repoFullName) {
    await setUserProjectActive(getPool(), Number(currentUser.id), repoFullName, active)
    revalidatePath('/workbench/integrations')
  }
  redirect('/workbench/integrations')
}

export async function addUserProjectAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')
  assertWritable(currentUser.login)

  const fullName = String(formData.get('repo') ?? '').trim()
  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(fullName)) redirect('/workbench/integrations?error=invalid')

  const pool = getPool()
  let repo = await findRepoByFullName(pool, fullName)
  if (!repo) {
    const token = await sessionAccessToken(session)
    if (!token) redirect('/workbench/integrations?error=need-token')
    const fetched = await fetchGitHubRepo(fullName, token)
    if (!fetched) redirect('/workbench/integrations?error=not-found')
    await upsertRepo(pool, fetched)
    repo = await findRepoByFullName(pool, fullName)
  }
  if (!repo) redirect('/workbench/integrations?error=not-found')

  await upsertUserProject(pool, Number(currentUser.id), repo.fullName, {
    source: 'manual',
    active: true,
    lastPushedAt: repo.pushedAt,
  })
  revalidatePath('/workbench/integrations')
  redirect('/workbench/integrations')
}

export async function removeUserProjectAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')
  assertWritable(currentUser.login)

  const repoFullName = String(formData.get('repo') ?? '').trim()
  if (repoFullName) {
    await removeUserProject(getPool(), Number(currentUser.id), repoFullName)
    revalidatePath('/workbench/integrations')
  }
  redirect('/workbench/integrations')
}

export async function setIntegrationOutcomeAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')
  assertWritable(currentUser.login)

  const project = String(formData.get('project') ?? '').trim()
  const repo = String(formData.get('repo') ?? '').trim()
  const status = String(formData.get('status') ?? '') === 'rejected' ? 'rejected' : 'adopted'
  const note = formData.has('note')
    ? String(formData.get('note') ?? '').trim().slice(0, 300) || null
    : undefined
  if (!project || !repo) redirect('/workbench/integrations')

  await setIntegrationOutcome(getPool(), Number(currentUser.id), project, repo, status, note)
  revalidatePath('/workbench/integrations')
  revalidatePath('/library')
  const requested = String(formData.get('returnTo') ?? '')
  redirect(
    requested.startsWith('/workbench/integrations') || requested.startsWith('/library')
      ? requested
      : '/workbench/integrations',
  )
}

export async function clearIntegrationOutcomeAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')
  assertWritable(currentUser.login)

  const project = String(formData.get('project') ?? '').trim()
  const repo = String(formData.get('repo') ?? '').trim()
  if (!project || !repo) redirect('/workbench/integrations')

  await clearIntegrationOutcome(getPool(), Number(currentUser.id), project, repo)
  revalidatePath('/workbench/integrations')
  revalidatePath('/library')
  const requested = String(formData.get('returnTo') ?? '')
  redirect(
    requested.startsWith('/workbench/integrations') || requested.startsWith('/library')
      ? requested
      : '/workbench/integrations',
  )
}

export async function markNotificationReadAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')
  assertWritable(currentUser.login)

  const id = Number(formData.get('id'))
  const requested = String(formData.get('returnTo') ?? '')
  const returnTo = requested.startsWith('/inbox') ? requested : '/inbox'
  if (Number.isFinite(id)) {
    await markNotificationRead(getPool(), Number(currentUser.id), id)
    revalidatePath('/inbox')
    revalidatePath('/')
  }
  redirect(returnTo)
}


export async function saveNotificationPrefsAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')
  assertWritable(currentUser.login)

  const emailKinds = formData
    .getAll('emailKinds')
    .map(String)
    .filter(isNotificationCategory)
  const pushKinds = formData
    .getAll('pushKinds')
    .map(String)
    .filter(isNotificationCategory)
  const routingConfigured = formData.get('routingConfigured') === '1'

  await saveNotificationPrefs(getPool(), Number(currentUser.id), {
    githubStar: formData.get('githubStar') === '1',
    githubFork: formData.get('githubFork') === '1',
    githubIssue: formData.get('githubIssue') === '1',
    githubPull: formData.get('githubPull') === '1',
    githubRelease: formData.get('githubRelease') === '1',
    emailNotifications: formData.get('emailNotifications') === '1',
    pushNotifications: formData.get('pushNotifications') === '1',
    weeklyDigest: formData.get('weeklyDigest') === '1',
    ...(routingConfigured ? { emailKinds, pushKinds } : {}),
  })
  revalidatePath('/settings')
  revalidatePath('/inbox')
  redirect('/settings?notify=saved')
}


export async function saveNotificationEmailAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')
  assertWritable(currentUser.login)

  const email = String(formData.get('email') ?? '').trim()
  if (email && !isValidMailAddress(email)) redirect('/settings?notify=email-invalid')
  await saveNotificationEmail(getPool(), Number(currentUser.id), email || null)
  revalidatePath('/settings')
  revalidatePath('/inbox')
  redirect('/settings?notify=email-saved')
}

export async function saveMailConfigAction(formData: FormData): Promise<void> {
  await requireAdmin()

  const pool = getPool()
  const status = await loadMailStatus(pool)
  if (status.source === 'env') redirect('/settings?mail=env')

  const host = String(formData.get('host') ?? '').trim()
  const port = Number(formData.get('port'))
  const secure = formData.get('secure') === '1'
  const user = String(formData.get('user') ?? '').trim() || null
  const pass = String(formData.get('pass') ?? '').trim() || null
  const from = String(formData.get('from') ?? '').trim() || null

  try {
    await saveMailConfig(pool, { host, port, secure, user, pass, from })
  } catch {
    redirect('/settings?mail=invalid')
  }
  revalidatePath('/settings')
  redirect('/settings?mail=saved')
}

export async function clearMailConfigAction(): Promise<void> {
  await requireAdmin()

  const pool = getPool()
  const status = await loadMailStatus(pool)
  if (status.source === 'env') redirect('/settings?mail=env')
  await clearMailConfig(pool)
  revalidatePath('/settings')
  redirect('/settings?mail=cleared')
}

export async function saveBaseUrlAction(formData: FormData): Promise<void> {
  await requireAdmin()

  const pool = getPool()
  const status = await resolveBaseUrlStatus(pool)
  if (status.source === 'env') redirect('/settings?site=env')

  try {
    await saveBaseUrl(pool, String(formData.get('siteUrl') ?? ''))
  } catch {
    redirect('/settings?site=invalid')
  }
  revalidatePath('/settings')
  redirect('/settings?site=saved')
}

export async function revokeRadarShareAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')
  assertWritable(currentUser.login)

  const token = String(formData.get('token') ?? '').trim()
  if (token) {
    await revokeRadarSnapshot(getPool(), Number(currentUser.id), token)
  }
  revalidatePath('/settings')
  redirect('/settings?share=revoked')
}

export async function deleteAccountAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')
  assertWritable(currentUser.login)

  const confirmation = String(formData.get('confirm') ?? '').trim()
  if (confirmation.toLowerCase() !== currentUser.login.toLowerCase()) {
    redirect('/settings?account=confirm')
  }

  const admins = adminLogins()
  if (admins.length === 1 && admins[0] === currentUser.login.toLowerCase()) {
    redirect('/settings?account=last-admin')
  }
  // 未配置 ADMIN_LOGINS 时，管理员身份按“最早注册用户”继承。
  // 如果当前用户是实际管理员且还有其他用户，删除会静默把管理员身份转给下一位，
  // 这里要求先显式配置 ADMIN_LOGINS 再删除。
  if (admins.length === 0 && (await isAdminUser(currentUser))) {
    const { rows } = await getPool().query<{ count: string }>('SELECT count(*)::text AS count FROM users')
    if (Number(rows[0]?.count ?? 0) > 1) redirect('/settings?account=last-admin')
  }

  const deleted = await deleteUserAccount(getPool(), Number(currentUser.id))
  if (!deleted) redirect('/settings?account=error')
  revalidatePath('/settings')
  await signOut({ redirectTo: '/' })
}

export async function saveQuotaConfigAction(formData: FormData): Promise<void> {
  await requireAdmin()
  const number = (name: string): number => {
    const value = Number(formData.get(name))
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
  }
  await saveQuotaConfig(getPool(), {
    aiEnabled: formData.get('aiEnabled') === '1',
    dailyAiCalls: number('dailyAiCalls'),
    dailyAiTokens: number('dailyAiTokens'),
    globalDailyTokens: number('globalDailyTokens'),
    hourlyJobs: number('hourlyJobs'),
    dailyJobs: number('dailyJobs'),
    maxQueuedJobs: number('maxQueuedJobs'),
    copilotMessagesPerHour: number('copilotMessagesPerHour'),
    dailyDeliveries: number('dailyDeliveries'),
  })
  revalidatePath('/settings')
  redirect('/settings?quota=saved')
}

export async function resetQuotaConfigAction(): Promise<void> {
  await requireAdmin()
  await clearQuotaConfig(getPool())
  revalidatePath('/settings')
  redirect('/settings?quota=reset')
}

export async function saveRetentionConfigAction(formData: FormData): Promise<void> {
  await requireAdmin()
  const number = (name: string): number => {
    const value = Number(formData.get(name))
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
  }
  await saveRetentionConfig(getPool(), {
    notificationsDays: number('notificationsDays'),
    deliveryQueueDays: number('deliveryQueueDays'),
    aiJobsDays: number('aiJobsDays'),
    activitySeenDays: number('activitySeenDays'),
    llmUsageDays: number('llmUsageDays'),
    ingestRunsDays: number('ingestRunsDays'),
    verificationsDays: number('verificationsDays'),
    copilotDays: number('copilotDays'),
    generatedContentDays: number('generatedContentDays'),
  })
  revalidatePath('/settings')
  redirect('/settings?retention=saved')
}

export async function resetRetentionConfigAction(): Promise<void> {
  await requireAdmin()
  await clearRetentionConfig(getPool())
  revalidatePath('/settings')
  redirect('/settings?retention=reset')
}

export async function runRetentionCleanupAction(): Promise<void> {
  await requireAdmin()
  try {
    await runRetentionIfDue(getPool(), { force: true })
  } catch (error) {
    console.error('[retention] 手动清理失败：', error)
    redirect('/settings?retention=error')
  }
  revalidatePath('/settings')
  redirect('/settings?retention=ran')
}

export async function saveOpsConfigAction(formData: FormData): Promise<void> {
  await requireAdmin()
  const number = (name: string, fallback: number): number => {
    const value = Number(formData.get(name))
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback
  }
  await saveOpsConfig(getPool(), {
    alertsEnabled: formData.get('alertsEnabled') === '1',
    alertEmails: String(formData.get('alertEmails') ?? ''),
    failedJobsThreshold: number('failedJobsThreshold', 3),
    failedDeliveriesThreshold: number('failedDeliveriesThreshold', 3),
    queueAgeMinutes: number('queueAgeMinutes', 60),
    cooldownMinutes: number('cooldownMinutes', 60),
  })
  revalidatePath('/ops')
  redirect('/ops?saved=1')
}

export async function resetOpsConfigAction(): Promise<void> {
  await requireAdmin()
  await clearOpsConfig(getPool())
  revalidatePath('/ops')
  redirect('/ops?reset=1')
}

export async function saveLlmPricesAction(formData: FormData): Promise<void> {
  await requireAdmin()
  const models = formData.getAll('model').map(String)
  const inputs = formData.getAll('input').map(String)
  const outputs = formData.getAll('output').map(String)

  const prices: Record<string, { input: number; output: number }> = {}
  for (let index = 0; index < models.length; index++) {
    const model = models[index]?.trim()
    if (!model) continue
    const rawInput = inputs[index]?.trim() ?? ''
    const rawOutput = outputs[index]?.trim() ?? ''
    if (!rawInput && !rawOutput) continue
    const input = Number(rawInput)
    const output = Number(rawOutput)
    if (!Number.isFinite(input) || input < 0 || !Number.isFinite(output) || output < 0) {
      redirect('/ops?prices=invalid')
    }
    prices[model] = { input, output }
  }

  await saveLlmPrices(getPool(), prices)
  revalidatePath('/ops')
  redirect('/ops?prices=saved')
}

export async function clearLlmPricesAction(): Promise<void> {
  await requireAdmin()
  await clearLlmPrices(getPool())
  revalidatePath('/ops')
  redirect('/ops?prices=cleared')
}

export async function saveGithubWebhookSecretAction(formData: FormData): Promise<void> {
  await requireAdmin()

  const existing = await resolveGithubWebhookSecret()
  if (existing?.source === 'env') redirect('/settings?webhook=env')

  const submitted = String(formData.get('secret') ?? '').trim()
  if (!submitted) {
    redirect(existing ? '/settings?webhook=saved' : '/settings?webhook=key-required')
  }
  if (!isValidWebhookSecret(submitted)) redirect('/settings?webhook=invalid')

  await saveGithubWebhookSecret(submitted)
  revalidatePath('/settings')
  redirect('/settings?webhook=saved')
}

export async function clearGithubWebhookSecretAction(): Promise<void> {
  await requireAdmin()

  const existing = await resolveGithubWebhookSecret()
  if (existing?.source === 'env') redirect('/settings?webhook=env')

  await clearGithubWebhookSecret()
  revalidatePath('/settings')
  redirect('/settings?webhook=cleared')
}
