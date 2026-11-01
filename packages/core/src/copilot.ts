import type { DbPool } from './db.js'
import type { ChatMessage } from './llm.js'

export interface CopilotProject {
  repo: string
  description: string
  language: string | null
  topics: string[]
}

export interface CopilotContext {
  login: string
  profile: {
    topics: Array<{ topic: string; weight: number }>
    languages: Array<{ language: string; weight: number }>
    starredCount: number
  } | null
  projects: CopilotProject[]
  maintainer: {
    projects: Array<{
      repo: string
      healthScore: number
      summary: string
      risks: string[]
      actions: string[]
      dependencies: Array<{ name: string; current: string | null; latest: string | null; risk: string }>
      items: Array<{ kind: string; number: number; title: string; priority: string; reason: string }>
    }>
  } | null
  integration: {
    projects: Array<{
      repo: string
      summary: string
      gaps: string[]
      suggestions: Array<{ repo: string; kind: string; reason: string }>
    }>
  } | null
  watch: Array<{
    intent: string
    matches: Array<{ repo: string; score: number; reason: string }>
  }>
  library?: {
    integration: {
      totals: { items: number; pending: number; adopted: number; rejected: number }
      pendingItems: Array<{ repo: string; total: number; projects: string[]; latestReason: string }>
    }
    watch: {
      totals: { items: number; pending: number; adopted: number; rejected: number }
      pendingItems: Array<{ repo: string; total: number; intents: string[]; latestReason: string }>
    }
    maintainer: {
      totals: { items: number; pending: number; adopted: number; rejected: number }
      pendingItems: Array<{ label: string; project: string; kind: string; total: number; latestDetail: string }>
    }
  }
  history: Array<{ kind: string; title: string; createdAt: string }>
}

export interface CopilotThread {
  id: number
  title: string | null
  createdAt: string
  updatedAt: string
}

export interface CopilotMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  model: string | null
  providerId: string | null
  createdAt: string
}

const SYSTEM_PROMPT = `你是 RepoRadar 的 AI 项目搭档。你了解用户正在维护的开源项目、维护周报、接入建议、关注代理和最近生成内容。
回答要求：
- 只能基于提供的上下文回答，不要编造仓库、版本、Issue 或 API 事实；不确定就说不确定，并告诉用户去哪里核实。
- 回答用中文，先给结论，再给 2-4 个具体下一步。
- 区分「已经完成」和「建议去做」；不要声称你已经修改代码、提交 PR 或关闭 Issue。
- 如果用户问“接什么/先做什么/哪里有问题”，优先引用上下文里的具体项目、依赖、Issue 和候选仓库。
- 需要执行时，指向对应页面：/workbench/integrations、/workbench/maintain、/workbench/watch、/compare、/repos。
- 控制篇幅，不要复述整份报告。`

export async function getOrCreateCopilotThread(pool: DbPool, userId: number): Promise<CopilotThread> {
  const { rows } = await pool.query<{
    id: string
    title: string | null
    created_at: Date | string
    updated_at: Date | string
  }>(
    `SELECT id, title, created_at, updated_at FROM copilot_threads
     WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1`,
    [userId],
  )
  if (rows[0]) {
    const row = rows[0]
    return {
      id: Number(row.id),
      title: row.title,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    }
  }

  const inserted = await pool.query<{
    id: string
    title: string | null
    created_at: Date | string
    updated_at: Date | string
  }>(`INSERT INTO copilot_threads (user_id) VALUES ($1) RETURNING id, title, created_at, updated_at`, [userId])
  const row = inserted.rows[0]!
  return {
    id: Number(row.id),
    title: row.title,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  }
}


export async function getCopilotThread(pool: DbPool, userId: number, id: number): Promise<CopilotThread | null> {
  const { rows } = await pool.query<{
    id: string
    title: string | null
    created_at: Date | string
    updated_at: Date | string
  }>(
    `SELECT id, title, created_at, updated_at FROM copilot_threads WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [id, userId],
  )
  const row = rows[0]
  if (!row) return null
  return {
    id: Number(row.id),
    title: row.title,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  }
}

export interface CopilotThreadSummary extends CopilotThread {
  messageCount: number
}

export async function listCopilotThreads(pool: DbPool, userId: number, limit = 20): Promise<CopilotThreadSummary[]> {
  const { rows } = await pool.query<{
    id: string
    title: string | null
    created_at: Date | string
    updated_at: Date | string
    message_count: string
  }>(
    `SELECT t.id, t.title, t.created_at, t.updated_at, count(m.id) AS message_count
     FROM copilot_threads t
     LEFT JOIN copilot_messages m ON m.thread_id = t.id
     WHERE t.user_id = $1
     GROUP BY t.id
     ORDER BY t.updated_at DESC
     LIMIT $2`,
    [userId, limit],
  )
  return rows.map((row) => ({
    id: Number(row.id),
    title: row.title,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    messageCount: Number(row.message_count),
  }))
}

export async function createCopilotThread(pool: DbPool, userId: number): Promise<CopilotThread> {
  const { rows } = await pool.query<{
    id: string
    title: string | null
    created_at: Date | string
    updated_at: Date | string
  }>(`INSERT INTO copilot_threads (user_id) VALUES ($1) RETURNING id, title, created_at, updated_at`, [userId])
  const row = rows[0]!
  return {
    id: Number(row.id),
    title: row.title,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  }
}

export async function deleteCopilotThread(pool: DbPool, userId: number, id: number): Promise<void> {
  await pool.query(`DELETE FROM copilot_threads WHERE id = $1 AND user_id = $2`, [id, userId])
}

export async function listCopilotMessages(
  pool: DbPool,
  threadId: number,
  limit = 100,
): Promise<CopilotMessage[]> {
  const { rows } = await pool.query<{
    id: string
    role: 'user' | 'assistant'
    content: string
    model: string | null
    provider_id: string | null
    created_at: Date | string
  }>(
    `SELECT id, role, content, model, provider_id, created_at
     FROM copilot_messages WHERE thread_id = $1
     ORDER BY created_at DESC LIMIT $2`,
    [threadId, limit],
  )
  return rows
    .map((row) => ({
      id: Number(row.id),
      role: row.role,
      content: row.content,
      model: row.model,
      providerId: row.provider_id,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    }))
    .reverse()
}

export async function addCopilotMessage(
  pool: DbPool,
  threadId: number,
  input: { role: 'user' | 'assistant'; content: string; model?: string | null; providerId?: string | null },
): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO copilot_messages (thread_id, role, content, model, provider_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [threadId, input.role, input.content, input.model ?? null, input.providerId ?? null],
  )
  await pool.query(`UPDATE copilot_threads SET updated_at = now() WHERE id = $1`, [threadId])
  return Number(rows[0]?.id ?? 0)
}

/** 删除线程里最后一条助手消息（仅当它确实是最后一条），用于重新生成。 */
export async function deleteLastCopilotAnswer(pool: DbPool, threadId: number): Promise<void> {
  await pool.query(
    `DELETE FROM copilot_messages
     WHERE id = (
       SELECT id FROM copilot_messages WHERE thread_id = $1 ORDER BY id DESC LIMIT 1
     ) AND role = 'assistant'`,
    [threadId],
  )
}

export async function updateCopilotTitle(pool: DbPool, threadId: number, title: string): Promise<void> {
  await pool.query(
    `UPDATE copilot_threads SET title = COALESCE(title, $2), updated_at = now() WHERE id = $1`,
    [threadId, title.slice(0, 80)],
  )
}

export async function clearCopilotThread(pool: DbPool, userId: number): Promise<void> {
  await pool.query(`DELETE FROM copilot_threads WHERE user_id = $1`, [userId])
}

export function buildCopilotMessages(
  context: CopilotContext,
  history: CopilotMessage[],
  question: string,
): ChatMessage[] {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `${SYSTEM_PROMPT}\n\n以下是用户当前的上下文（JSON）：\n${JSON.stringify(context)}`,
    },
  ]
  const recent = history.slice(-10)
  // Anthropic 等接口要求 user/assistant 交替；上一次失败留下的末尾 user 消息先丢掉
  while (recent.length > 0 && recent[recent.length - 1]?.role === 'user') recent.pop()
  for (const message of recent) {
    messages.push({ role: message.role, content: message.content })
  }
  messages.push({ role: 'user', content: question })
  return messages
}
