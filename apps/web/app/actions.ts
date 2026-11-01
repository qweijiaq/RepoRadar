'use server'

import {
  GITHUB_REPO_SCOPES,
  addCollectionItem,
  addNotification,
  addSubscription,
  buildDiscoveryQueries,
  buildFeedbackContext,
  chatCompletion,
  clearMailConfig,
  clearOpsConfig,
  clearQuotaConfig,
  clearRetentionConfig,
  clearStoredLlmConfig,
  createCollection,
  deleteCollection,
  deleteUserAccount,
  findCollection,
  findEnrichedRepos,
  findLlmProvider,
  findRepoByFullName,
  generateIntegrationReport,
  evaluateSetupAccess,
  isDependencyUsed,
  isValidGithubClientId,
  isValidGithubClientSecret,
  isValidSubscriptionValue,
  listFeedbackSignals,
  listIntegrationOutcomes,
  listUserProjects,
  loadConfig,
  loadFeedback,
  loadMailStatus,
  loadStoredLlmConfig,
  loadSubscriptions,
  markNotificationRead,
  markNotificationsRead,
  rankForUser,
  resolveBaseUrlStatus,
  resolveMailConfig,
  resolveNotificationEmail,
  runRetentionIfDue,
  removeCollectionItem,
  removeSubscription,
  removeUserProject,
  saveBaseUrl,
  saveIntegrationReport,
  saveMailConfig,
  saveNotificationEmail,
  saveOpsConfig,
  saveQuotaConfig,
  saveRetentionConfig,
  saveNotificationPrefs,
  saveStoredLlmConfig,
  searchRepos,
  setCollectionPublic,
  setFeedback,
  setIntegrationOutcome,
  setUserProjectActive,
  isValidMailAddress,
  upsertRepo,
  upsertUserProject,
  type IntegrationCandidate,
  type SubscriptionKind,
} from '@repo-radar/core'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth, signIn, signOut } from '@/auth'
import { getPool } from '@/lib/db'
import { saveIssueDraft } from '@/lib/issue-drafts'
import { generateIssueForUser } from '@/lib/issue-generation'
import { clearGithubCredentials, resolveGithubCredentials, saveGithubCredentials } from '@/lib/oauth-config'
import {
  clearGithubWebhookSecret,
  isValidWebhookSecret,
  resolveGithubWebhookSecret,
  saveGithubWebhookSecret,
} from '@/lib/webhook-config'
import { adminLogins, requireAdmin } from '@/lib/admin'
import { guardAiQuota } from '@/lib/quota-guard'
import { sessionAccessToken, sessionUser } from '@/lib/session'
import { fetchGitHubRepo, loadProjectContext } from '@/lib/project-context'
import { rebuildProfile, syncUserTaste } from '@/lib/sync'
import { findUserById, savePrefs } from '@/lib/users'
import { sendMail } from '@/lib/mailer'

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

export async function signInDevAction(): Promise<void> {
  await signIn('dev', { redirectTo: '/feed' })
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
    const status = /(4\d{2}|5\d{2})/.exec(failure)?.[1]
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

  await savePrefs(Number(currentUser.id), {
    excludedTopics: parseList(formData.get('excludedTopics')),
    excludedLanguages: parseList(formData.get('excludedLanguages')),
  })
  await rebuildProfile(Number(currentUser.id))
  revalidatePath('/settings')
  revalidatePath('/feed')
}

export async function resyncStarsAction(): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')

  const token = sessionAccessToken(session)
  let failed = false
  if (token) {
    try {
      await syncUserTaste(Number(currentUser.id), currentUser.login, token)
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
  revalidatePath('/settings')
  revalidatePath('/feed')
}

export async function submitFeedbackAction(formData: FormData): Promise<void> {  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')

  const repoFullName = String(formData.get('repo') ?? '').trim()
  if (!repoFullName) return

  const kind = String(formData.get('kind') ?? '') === 'hide' ? 'hide' : 'save'
  const userId = Number(currentUser.id)
  const pool = getPool()
  const current = await loadFeedback(pool, userId)
  // 再次点击同一个按钮表示取消
  await setFeedback(pool, userId, repoFullName, current.get(repoFullName) === kind ? null : kind)
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

  const kind = parseSubscriptionKind(formData.get('kind'))
  const value = String(formData.get('value') ?? '').trim()
  if (!kind || !isValidSubscriptionValue(kind, value)) redirect('/settings?sub=invalid')

  await addSubscription(getPool(), Number(currentUser.id), kind, value)
  revalidatePath('/settings')
  revalidatePath('/feed')
}

export async function removeSubscriptionAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')

  const kind = parseSubscriptionKind(formData.get('kind'))
  const value = String(formData.get('value') ?? '').trim()
  if (!kind || !value) return

  await removeSubscription(getPool(), Number(currentUser.id), kind, value)
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

export async function generateIssueAction(): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')

  await guardAiQuota(getPool(), Number(currentUser.id))
  const llm = loadConfig().llm ?? (await loadStoredLlmConfig(getPool()))
  if (!llm) redirect('/settings?llm=missing')

  let draftId = 0
  try {
    const generated = await generateIssueForUser(Number(currentUser.id), llm)
    draftId = await saveIssueDraft(getPool(), {
      userId: Number(currentUser.id),
      ...generated,
      model: llm.model,
      providerId: llm.providerId ?? null,
    })
    await addNotification(getPool(), Number(currentUser.id), {
      kind: 'issue',
      title: '新一期周报已生成',
      body: generated.title,
      url: `/issue?draft=${draftId}`,
    })
  } catch (error) {
    console.error('[issue] 生成周报失败：', error)
    redirect('/issue?error=1')
  }

  revalidatePath('/issue')
  redirect(`/issue?draft=${draftId}`)
}

export async function markInboxReadAction(): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')

  await markNotificationsRead(getPool(), Number(currentUser.id))
  revalidatePath('/inbox')
  revalidatePath('/', 'layout')
  redirect('/inbox')
}

export async function createCollectionAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')

  const name = String(formData.get('name') ?? '').trim()
  if (!name) redirect('/collections?error=name')
  const description = String(formData.get('description') ?? '').trim()
  const id = await createCollection(
    getPool(),
    Number(currentUser.id),
    name.slice(0, 80),
    description ? description.slice(0, 300) : null,
  )
  revalidatePath('/collections')
  redirect(`/collections/${id}`)
}

async function ownedCollection(collectionId: number, userId: number) {
  const collection = await findCollection(getPool(), collectionId)
  return collection && collection.userId === userId ? collection : null
}

function safeReturnTo(value: FormDataEntryValue | null, fallback: string): string {
  const path = String(value ?? '')
  return path.startsWith('/') ? path : fallback
}

export async function addToCollectionAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')

  const collectionId = Number(formData.get('collectionId'))
  const repoFullName = String(formData.get('repo') ?? '').trim()
  const note = String(formData.get('note') ?? '').trim()
  const returnTo = safeReturnTo(formData.get('returnTo'), '/collections')

  if (repoFullName && (await ownedCollection(collectionId, Number(currentUser.id)))) {
    await addCollectionItem(getPool(), collectionId, repoFullName, note || null)
    revalidatePath(`/collections/${collectionId}`)
  }
  redirect(returnTo)
}

export async function removeCollectionItemAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')

  const collectionId = Number(formData.get('collectionId'))
  const repoFullName = String(formData.get('repo') ?? '').trim()
  const returnTo = safeReturnTo(formData.get('returnTo'), `/collections/${collectionId}`)

  if (repoFullName && (await ownedCollection(collectionId, Number(currentUser.id)))) {
    await removeCollectionItem(getPool(), collectionId, repoFullName)
    revalidatePath(`/collections/${collectionId}`)
  }
  redirect(returnTo)
}

export async function toggleCollectionPublicAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')

  const collectionId = Number(formData.get('collectionId'))
  const collection = await ownedCollection(collectionId, Number(currentUser.id))
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

  const collectionId = Number(formData.get('collectionId'))
  if (await ownedCollection(collectionId, Number(currentUser.id))) {
    await deleteCollection(getPool(), collectionId)
    revalidatePath('/collections')
  }
  redirect('/collections')
}

export async function toggleProjectActiveAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')

  const repoFullName = String(formData.get('repo') ?? '').trim()
  const active = String(formData.get('active') ?? '') === '1'
  if (repoFullName) {
    await setUserProjectActive(getPool(), Number(currentUser.id), repoFullName, active)
    revalidatePath('/integrations')
  }
  redirect('/integrations')
}

export async function addUserProjectAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')

  const fullName = String(formData.get('repo') ?? '').trim()
  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(fullName)) redirect('/integrations?error=invalid')

  const pool = getPool()
  let repo = await findRepoByFullName(pool, fullName)
  if (!repo) {
    const token = sessionAccessToken(session)
    if (!token) redirect('/integrations?error=need-token')
    const fetched = await fetchGitHubRepo(fullName, token)
    if (!fetched) redirect('/integrations?error=not-found')
    await upsertRepo(pool, fetched)
    repo = await findRepoByFullName(pool, fullName)
  }
  if (!repo) redirect('/integrations?error=not-found')

  await upsertUserProject(pool, Number(currentUser.id), repo.fullName, {
    source: 'manual',
    active: true,
    lastPushedAt: repo.pushedAt,
  })
  revalidatePath('/integrations')
  redirect('/integrations')
}

export async function removeUserProjectAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')

  const repoFullName = String(formData.get('repo') ?? '').trim()
  if (repoFullName) {
    await removeUserProject(getPool(), Number(currentUser.id), repoFullName)
    revalidatePath('/integrations')
  }
  redirect('/integrations')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function generateIntegrationAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')
  await guardAiQuota(getPool(), Number(currentUser.id))

  const pool = getPool()
  const llm = loadConfig().llm ?? (await loadStoredLlmConfig(pool))
  if (!llm) redirect('/settings?llm=missing')

  const focus = String(formData.get('focus') ?? '').trim().slice(0, 200) || null
  const userId = Number(currentUser.id)
  const projects = await listUserProjects(pool, userId)
  let selected = projects.filter((project) => project.active)
  let auto = false
  if (selected.length === 0) {
    selected = projects.filter((project) => project.source === 'owned').slice(0, 3)
    auto = selected.length > 0
  }
  if (selected.length === 0) redirect('/integrations?error=no-projects')
  selected = selected.slice(0, 3)

  let reportId = 0
  try {
    const token = sessionAccessToken(session)
    const contexts = await Promise.all(      selected.map((project) => loadProjectContext(project.repoFullName, token)),
    )
    const [feedback, signals, subscriptions, user, repos, outcomes] = await Promise.all([
      loadFeedback(pool, userId),
      listFeedbackSignals(pool, userId),
      loadSubscriptions(pool, userId),
      findUserById(userId),
      findEnrichedRepos(pool, 500),
      listIntegrationOutcomes(pool, userId),
    ])
    const context = buildFeedbackContext(feedback, signals)
    const projectNames = new Set(selected.map((project) => project.repoFullName))
    const dependencies = [...new Set(contexts.flatMap((item) => item.dependencies))]
    const ranked = rankForUser(
      user?.profile ?? null,
      repos.filter((repo) => !projectNames.has(repo.fullName)),
      Date.now(),
      context,
      subscriptions,
    ).slice(0, 40)

    const candidateMap = new Map<string, IntegrationCandidate>()
    for (const repo of ranked) {
      candidateMap.set(repo.fullName, {
        repo: repo.fullName,
        summary: repo.summary ?? repo.description ?? '',
        language: repo.language,
        topics: repo.topics,
        stars: repo.stars,
        verified: repo.verifyStatus === 'verified',
        reason: repo.reason,
        alreadyUsed: isDependencyUsed(repo.fullName, dependencies),
      })
    }

    // 候选池按项目主题现场扩召；失败不阻塞精选候选。
    if (token) {
      for (const query of buildDiscoveryQueries(contexts)) {
        if (candidateMap.size >= 60) break
        try {
          const found = await searchRepos(query, { token, perPage: 10 })
          for (const repo of found) {
            if (projectNames.has(repo.fullName) || candidateMap.has(repo.fullName)) continue
            await upsertRepo(pool, repo)
            candidateMap.set(repo.fullName, {
              repo: repo.fullName,
              summary: repo.description ?? '',
              language: repo.language,
              topics: repo.topics,
              stars: repo.stars,
              verified: false,
              reason: 'GitHub 搜索发现',
              alreadyUsed: isDependencyUsed(repo.fullName, dependencies),
            })
            if (candidateMap.size >= 60) break
          }
        } catch (error) {
          console.error('[integrations] 候选搜索失败：', error)
        }
        await sleep(350)
      }
    }

    const candidates = [...candidateMap.values()]
    if (candidates.length === 0) throw new Error('没有可用的候选仓库')

    const report = await generateIntegrationReport(contexts, candidates, llm, focus, outcomes)
    reportId = await saveIntegrationReport(pool, userId, {
      report,
      usedProjects: selected.map((project) => project.repoFullName),
      auto,
      focus,
      generatedAt: new Date().toISOString(),
      model: llm.model,
      providerId: llm.providerId ?? null,
      candidateCount: candidates.length,
      candidateRepos: candidates.map((candidate) => candidate.repo),
    })
    await addNotification(pool, userId, {
      kind: 'integration',
      title: '接入建议已生成',
      body: report.projects.map((project) => project.repo).join('、'),
      url: `/integrations?report=${reportId}`,
    })
  } catch (error) {
    console.error('[integrations] 生成接入建议失败：', error)
    const detail = error instanceof Error ? error.message : ''
    const code = /JSON|结构不符合/.test(detail) ? 'format' : 'generate'
    redirect(`/integrations?error=${code}`)
  }

  revalidatePath('/integrations')
  redirect(`/integrations?report=${reportId}`)
}

export async function setIntegrationOutcomeAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')

  const project = String(formData.get('project') ?? '').trim()
  const repo = String(formData.get('repo') ?? '').trim()
  const status = String(formData.get('status') ?? '') === 'rejected' ? 'rejected' : 'adopted'
  if (!project || !repo) redirect('/integrations')

  await setIntegrationOutcome(getPool(), Number(currentUser.id), project, repo, status)
  revalidatePath('/integrations')
  redirect('/integrations')
}

export async function markNotificationReadAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')

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

  await saveNotificationPrefs(getPool(), Number(currentUser.id), {
    githubStar: formData.get('githubStar') === '1',
    githubFork: formData.get('githubFork') === '1',
    githubIssue: formData.get('githubIssue') === '1',
    githubPull: formData.get('githubPull') === '1',
    githubRelease: formData.get('githubRelease') === '1',
    emailNotifications: formData.get('emailNotifications') === '1',
    pushNotifications: formData.get('pushNotifications') === '1',
    weeklyDigest: formData.get('weeklyDigest') === '1',
  })
  revalidatePath('/settings')
  revalidatePath('/inbox')
  redirect('/settings?notify=saved')
}


export async function saveNotificationEmailAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')

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

export async function deleteAccountAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')

  const confirmation = String(formData.get('confirm') ?? '').trim()
  if (confirmation.toLowerCase() !== currentUser.login.toLowerCase()) {
    redirect('/settings?account=confirm')
  }

  const admins = adminLogins()
  if (admins.length === 1 && admins[0] === currentUser.login.toLowerCase()) {
    redirect('/settings?account=last-admin')
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
