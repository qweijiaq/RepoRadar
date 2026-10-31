'use server'

import {
  addNotification,
  createWatchIntent,
  deleteWatchIntent,
  findEnrichedRepos,
  findWatchIntent,
  generateWatchMatches,
  listFeedStatuses,
  listWatchIntents,
  loadConfig,
  loadStoredLlmConfig,
  saveWatchMatches,
  saveWatchRun,
} from '@repo-radar/core'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { getPool } from '@/lib/db'
import { sessionUser } from '@/lib/session'

const MAX_INTENTS = 10

export async function createWatchIntentAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')

  const text = String(formData.get('text') ?? '').trim()
  if (text.length < 5 || text.length > 300) redirect('/watch?error=invalid')

  const pool = getPool()
  const userId = Number(currentUser.id)
  const existing = await listWatchIntents(pool, userId)
  if (existing.length >= MAX_INTENTS) redirect('/watch?error=limit')

  await createWatchIntent(pool, userId, text)
  revalidatePath('/watch')
  redirect('/watch?created=1')
}

export async function deleteWatchIntentAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')

  const id = Number(formData.get('id'))
  if (Number.isFinite(id)) {
    await deleteWatchIntent(getPool(), Number(currentUser.id), id)
    revalidatePath('/watch')
  }
  redirect('/watch')
}

export async function runWatchIntentAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')

  const pool = getPool()
  const llm = loadConfig().llm ?? (await loadStoredLlmConfig(pool))
  if (!llm) redirect('/settings?llm=missing')

  const id = Number(formData.get('id'))
  const intent = Number.isFinite(id) ? await findWatchIntent(pool, Number(currentUser.id), id) : null
  if (!intent) redirect('/watch?error=not-found')

  try {
    const repos = await findEnrichedRepos(pool, 80)
    const candidates = repos.map((repo) => ({
      repo: repo.fullName,
      summary: repo.summary ?? repo.description ?? '',
      language: repo.language,
      topics: repo.topics,
      stars: repo.stars,
    }))
    if (candidates.length === 0) throw new Error('候选池为空，请先运行采集和富化')

    const matches = await generateWatchMatches(intent.text, candidates, llm)
    const completed = new Set((await listFeedStatuses(pool, Number(currentUser.id))).map((status) => status.key))
    const activeMatches = matches.filter(
      (match) => !completed.has(`watch:${intent.id}:${match.repo}`),
    )
    await saveWatchMatches(pool, intent.id, activeMatches)
    await saveWatchRun(pool, intent.id, {
      model: llm.model,
      providerId: llm.providerId ?? null,
      matchCount: activeMatches.length,
    })
    if (activeMatches.length > 0) {
      await addNotification(pool, Number(currentUser.id), {
        kind: 'watch',
        title: '订阅代理发现新匹配',
        body: `${intent.text}：${activeMatches.slice(0, 3).map((match) => match.repo).join('、')}`,
        url: '/watch',
      })
    }
    revalidatePath('/watch')
    redirect(`/watch?run=${activeMatches.length > 0 ? 'ok' : 'empty'}&count=${activeMatches.length}`)
  } catch (error) {
    console.error('[watch] 运行订阅代理失败：', error)
    const detail = error instanceof Error ? error.message : ''
    redirect(`/watch?error=${/JSON|结构不符合/.test(detail) ? 'format' : 'run'}`)
  }
}
