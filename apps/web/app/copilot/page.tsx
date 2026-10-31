import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCopilotThread, getOrCreateCopilotThread, listCopilotMessages, listCopilotThreads } from '@repo-radar/core'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { auth } from '@/auth'
import { getPool } from '@/lib/db'
import { sessionUser } from '@/lib/session'
import { enqueueIntegrationAction, enqueueMaintainerAction } from '@/app/jobs/enqueue'
import { clearCopilotAction, newCopilotThreadAction } from './actions'
import { CopilotChat } from './copilot-chat'

export const dynamic = 'force-dynamic'

interface CopilotPageProps {
  searchParams: Promise<{ thread?: string }>
}

export default async function CopilotPage({ searchParams }: CopilotPageProps) {
  const params = await searchParams
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')

  const pool = getPool()
  const userId = Number(currentUser.id)
  const requestedThread = Number(params.thread)
  const selectedThread =
    Number.isFinite(requestedThread) && requestedThread > 0
      ? await getCopilotThread(pool, userId, requestedThread)
      : null
  const thread = selectedThread ?? (await getOrCreateCopilotThread(pool, userId))
  const [messages, threads] = await Promise.all([
    listCopilotMessages(pool, thread.id),
    listCopilotThreads(pool, userId),
  ])

  return (
    <div className="page narrow">
      <section className="feed-head">
        <div>
          <p className="eyebrow">AI 搭档</p>
          <h1>问雷达</h1>
          <p className="feed-meta">
            它读过你的维护项目、维护周报、接入建议和关注代理，可以直接问下一步。
          </p>
          <p className="muted small">
            需要更完整的分析？也可以去 <Link href="/maintain">维护周报</Link> 或{' '}
            <Link href="/integrations">接入建议</Link> 生成报告。
          </p>
        </div>
        {messages.length > 0 ? (
          <div className="feed-actions">
            <form action={newCopilotThreadAction}>
              <button className="btn small" type="submit">
                新对话
              </button>
            </form>
            <ConfirmDialog
              action={clearCopilotAction}
              fields={{ threadId: String(thread.id) }}
              triggerLabel="删除对话"
              triggerClassName="btn quiet small"
              title="删除这段对话"
              description="会删除这段对话的所有消息，但不会删除已经生成的项目报告或历史记录。"
              confirmLabel="确认清空"
            />
          </div>
        ) : null}
      </section>

      <div className="copilot-quick-actions">
        <span className="muted small">快捷动作</span>
        <form action={enqueueMaintainerAction}>
          <button className="btn small" type="submit">
            生成维护周报
          </button>
        </form>
        <form action={enqueueIntegrationAction}>
          <button className="btn small" type="submit">
            生成接入建议
          </button>
        </form>
        <Link className="btn quiet small" href="/integrations">
          看最新接入
        </Link>
        <Link className="btn quiet small" href="/tasks">
          任务中心
        </Link>
      </div>

      <div className="copilot-layout">
        <aside className="copilot-threads">
          <div className="copilot-threads-head">
            <span className="eyebrow">对话</span>
          </div>
          {threads.map((item) => (
            <Link
              key={item.id}
              className={item.id === thread.id ? 'copilot-thread-link active' : 'copilot-thread-link'}
              href={`/copilot?thread=${item.id}`}
            >
              <span>{item.title ?? '新对话'}</span>
              <small>{item.messageCount} 条</small>
            </Link>
          ))}
        </aside>

        <CopilotChat
          threadId={thread.id}
          initialMessages={messages.map((message) => ({
          id: String(message.id),
          role: message.role,
          content: message.content,
          model: message.model,
          }))}
        />
      </div>
    </div>
  )
}
