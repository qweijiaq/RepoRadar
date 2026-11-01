import { redirect } from 'next/navigation'
import { enqueueIssueAction } from '@/app/(app)/jobs/enqueue'
import { auth } from '@/auth'
import { getPool } from '@/lib/db'
import { findIssueDraft, findLatestIssueDraft } from '@/lib/issue-drafts'
import { sessionUser } from '@/lib/session'
import { CopyIntegrationButton } from '@/app/(app)/workbench/integrations/copy-button'
import { IssuePreview } from './issue-preview'
import { GenerateIssueButton } from './generate-button'

export const dynamic = 'force-dynamic'

interface IssuePageProps {
  searchParams: Promise<{ error?: string; draft?: string }>
}

export default async function IssuePage({ searchParams }: IssuePageProps) {
  const params = await searchParams
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')

  const requestedDraft = Number(params.draft)
  const [latestDraft, selectedDraft] = await Promise.all([
    findLatestIssueDraft(getPool(), Number(currentUser.id)),
    Number.isFinite(requestedDraft) && requestedDraft > 0
      ? findIssueDraft(getPool(), Number(currentUser.id), requestedDraft)
      : Promise.resolve(null),
  ])
  const draft = selectedDraft ?? latestDraft

  return (
    <div className="page">
      <section className="feed-head">
        <div>
          <p className="eyebrow">周报</p>
          <h1>{draft ? draft.title : '本期技术简报'}</h1>
          <p className="feed-meta">
            {draft
              ? `生成于 ${new Date(draft.createdAt).toLocaleString('zh-CN')}${
                  draft.model ? ` · ${draft.providerId ? `${draft.providerId} · ` : ''}${draft.model}` : ''
                }${selectedDraft ? ' · 历史版本' : ''}`
              : '把最近值得看的项目写成一期带判断的简报'}
          </p>
        </div>
        <div className="feed-actions">
          <a className="btn small" href="/library?tab=history&kind=issue">
            历史生成
          </a>
          <form action={enqueueIssueAction}>
            <GenerateIssueButton hasDraft={Boolean(draft)} />
          </form>
          {draft ? (
            <>
              <CopyIntegrationButton text={draft.markdown} label="复制 Markdown" className="btn quiet small" />
              <a className="btn small" href={`/api/issues/${draft.id}`}>
                下载 HTML
              </a>
            </>
          ) : null}
        </div>
      </section>

      {params.error ? (
        <div className="notice">生成失败，请检查模型配置、网络或稍后重试。</div>
      ) : null}

      {draft ? (
        <IssuePreview html={draft.html} title={draft.title} />
      ) : (
        <div className="empty">
          <p>还没有生成过周报。</p>
          <p className="small">
            点击右上角「生成本期周报」，RepoRadar 会根据你的画像、反馈和订阅，生成一期可以发送的 HTML 简报。
          </p>
          <p className="small">需要先在设置里配置 AI 模型；版本更新来自已同步的 release 事件。</p>
        </div>
      )}
    </div>
  )
}
