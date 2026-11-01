import Link from 'next/link'
import { redirect } from 'next/navigation'
import { listFeedStatuses, listWatchIntents, listWatchMatches } from '@repo-radar/core'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { auth } from '@/auth'
import { getPool } from '@/lib/db'
import { sessionUser } from '@/lib/session'
import { markFeedItemDoneAction } from '@/app/feed/actions'
import { enqueueWatchRunAction } from '@/app/jobs/enqueue'
import { createWatchIntentAction, deleteWatchIntentAction } from './actions'
import { WatchSubmitButton } from './submit-button'

export const dynamic = 'force-dynamic'

interface WatchPageProps {
  searchParams: Promise<{ error?: string; created?: string; run?: string; count?: string }>
}

export default async function WatchPage({ searchParams }: WatchPageProps) {
  const params = await searchParams
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')

  const pool = getPool()
  const [intents, statuses] = await Promise.all([
    listWatchIntents(pool, Number(currentUser.id)),
    listFeedStatuses(pool, Number(currentUser.id)),
  ])
  const statusKeys = new Set(statuses.map((status) => status.key))
  const withMatches = await Promise.all(
    intents.map(async (intent) => ({
      intent,
      matches: (await listWatchMatches(pool, intent.id)).filter(
        (match) => !statusKeys.has(`watch:${intent.id}:${match.repo}`),
      ),
    })),
  )

  return (
    <div className="page">
      <section className="feed-head">
        <div>
          <p className="eyebrow">订阅代理</p>
          <h1>用一句话盯着你想找的项目</h1>
          <p className="feed-meta">
            不用拆 topic 和语言，直接描述需求。AI 会在候选池里判断哪些项目真正匹配，并解释原因。
          </p>
        </div>
        <div className="feed-actions">
          <Link className="btn small" href="/history?kind=watch">
            历史生成
          </Link>
        </div>
      </section>

      {params.error === 'invalid' ? <div className="notice">描述需要 5-300 个字符。</div> : null}
      {params.error === 'limit' ? <div className="notice">最多同时保留 10 个关注意图。</div> : null}
      {params.error === 'not-found' ? <div className="notice">关注意图不存在或已被删除。</div> : null}
      {params.error === 'run' ? <div className="notice">运行失败，请稍后重试。</div> : null}
      {params.error === 'format' ? (
        <div className="notice">模型返回格式异常，已自动重试；仍然失败请换一个模型。</div>
      ) : null}
      {params.created === '1' ? <div className="notice success">关注意图已创建，点「运行匹配」开始找。</div> : null}
      {params.run === 'ok' ? (
        <div className="notice success">这次找到 {params.count ?? 0} 个匹配，已写入下方列表。</div>
      ) : null}
      {params.run === 'empty' ? <div className="notice">这次没有找到足够匹配的项目。可以调整描述或稍后再试。</div> : null}

      <section className="panel">
        <h2>新的关注意图</h2>
        <form action={createWatchIntentAction} className="watch-form">
          <textarea
            name="text"
            rows={3}
            maxLength={300}
            placeholder="例如：MIT 许可证、TypeScript 写的、能做 agent 长期记忆、最近三个月有 release 的项目"
            required
          />
          <div className="form-actions">
            <WatchSubmitButton label="创建关注" pendingLabel="创建中…" />
          </div>
        </form>
        <p className="muted small">
          当前会在已收录的高质量候选池里匹配（按质量分取前 120 个），不会自动向 GitHub 发起搜索。
        </p>
      </section>

      {withMatches.length === 0 ? (
        <div className="empty">
          <p>还没有关注意图。</p>
          <p className="small">创建后点「运行匹配」，AI 会从候选池里挑出符合描述的项目。</p>
        </div>
      ) : (
        withMatches.map(({ intent, matches }) => (
          <article className="integration-card watch-card" key={intent.id}>
            <header className="integration-head">
              <div>
                <p className="watch-intent">{intent.text}</p>
                <span className="integration-auto">
                  创建于 {new Date(intent.createdAt).toLocaleDateString('zh-CN')}
                </span>
              </div>
              <div className="integration-head-actions">
                <form action={enqueueWatchRunAction}>
                  <input type="hidden" name="id" value={intent.id} />
                  <WatchSubmitButton label="运行匹配" pendingLabel="匹配中…" />
                </form>
                <ConfirmDialog
                  action={deleteWatchIntentAction}
                  fields={{ id: String(intent.id) }}
                  triggerLabel="删除"
                  triggerClassName="btn quiet danger small"
                  title="删除关注意图"
                  description="删除后这个意图的历史匹配也会一并删除，不影响已收藏的仓库。"
                  confirmLabel="确认删除"
                />
              </div>
            </header>

            {matches.length > 0 ? (
              <ul className="watch-matches">
                {matches.map((match) => (
                  <li key={match.repo}>
                    <div className="suggestion-head">
                      <Link href={`/r/${match.repo}`}>{match.repo}</Link>
                      <span className="chip used">匹配 {match.score}</span>
                      <a href={`https://github.com/${match.repo}`} target="_blank" rel="noreferrer" className="muted small">
                        GitHub
                      </a>
                      <form action={markFeedItemDoneAction} className="inline-form">
                        <input type="hidden" name="itemKey" value={`watch:${intent.id}:${match.repo}`} />
                        <input type="hidden" name="kind" value="watch" />
                        <input type="hidden" name="returnTo" value="/watch" />
                        <button className="btn quiet small" type="submit">
                          已接入
                        </button>
                      </form>
                    </div>
                    <p className="muted small">{match.reason}</p>
                    <span className="integration-auto">
                      匹配于 {new Date(match.createdAt).toLocaleString('zh-CN')}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small watch-empty">还没有匹配结果。点击「运行匹配」开始。</p>
            )}
          </article>
        ))
      )}
    </div>
  )
}
