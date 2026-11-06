import { NextResponse } from 'next/server'
import {
  addCopilotMessage,
  assertCopilotQuota,
  buildCopilotMessages,
  chatCompletion,
  deleteLastCopilotAnswer,
  getCopilotThread,
  getOrCreateCopilotThread,
  isQuotaError,
  listCopilotMessages,
  loadConfig,
  loadStoredLlmConfig,
  recordLlmUsageRows,
  updateCopilotTitle,
  PROMPT_VERSIONS,
  withLlmUsage,
  getPool,
} from '@repo-radar/core'
import { auth } from '@/auth'
import { loadCopilotContext } from '@/lib/copilot-context'
import { isDemoLogin } from '@/lib/readonly'
import { sessionUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<NextResponse> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (isDemoLogin(currentUser.login)) {
    return NextResponse.json({ error: 'demo-readonly' }, { status: 403 })
  }

  let body: { message?: unknown; threadId?: unknown; regenerate?: unknown }
  try {
    body = (await request.json()) as { message?: unknown; threadId?: unknown; regenerate?: unknown }
  } catch {
    return NextResponse.json({ error: '请求格式不正确' }, { status: 400 })
  }

  const message = typeof body.message === 'string' ? body.message.trim().slice(0, 2000) : ''
  if (message.length < 1) return NextResponse.json({ error: '消息不能为空' }, { status: 400 })
  const regenerate = body.regenerate === true

  const pool = getPool()
  const llm = loadConfig().llm ?? (await loadStoredLlmConfig(pool))
  if (!llm) return NextResponse.json({ error: '还没有配置 AI 模型，请先到设置页配置' }, { status: 400 })

  const userId = Number(currentUser.id)
  try {
    await assertCopilotQuota(pool, userId)
  } catch (error) {
    if (isQuotaError(error)) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 429 })
    }
    throw error
  }
  const requestedThread = Number(body.threadId)
  const thread =
    (Number.isFinite(requestedThread) && requestedThread > 0
      ? await getCopilotThread(pool, userId, requestedThread)
      : null) ?? (await getOrCreateCopilotThread(pool, userId))
  let history = await listCopilotMessages(pool, thread.id)
  if (regenerate) {
    await deleteLastCopilotAnswer(pool, thread.id)
    history = await listCopilotMessages(pool, thread.id)
  } else {
    await addCopilotMessage(pool, thread.id, { role: 'user', content: message })
    await updateCopilotTitle(pool, thread.id, message)
  }

  try {
    const context = await loadCopilotContext(pool, userId, currentUser.login)
    const content = await withLlmUsage(
      () =>
        chatCompletion(llm, buildCopilotMessages(context, history, message), {
          temperature: 0.4,
          maxTokens: 2200,
        }),
      (usage) => recordLlmUsageRows(pool, userId, null, 'copilot', usage),
      { promptVersion: PROMPT_VERSIONS.copilot },
    )
    await addCopilotMessage(pool, thread.id, {
      role: 'assistant',
      content,
      model: llm.model,
      providerId: llm.providerId ?? null,
    })
    return NextResponse.json({ content, model: llm.model })
  } catch (error) {
    console.error('[copilot] 回答失败：', error)
    const detail = error instanceof Error ? error.message : '模型调用失败'
    return NextResponse.json({ error: detail.slice(0, 300) }, { status: 502 })
  }
}
