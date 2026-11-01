import Link from 'next/link'
import { redirect } from 'next/navigation'
import { buildIssuePlanBrief, findIssuePlanById, findLatestIssuePlan, listPatchDrafts, loadHandledState, getPool } from '@repo-radar/core'
import { enqueuePatchAction } from '@/app/(app)/jobs/enqueue'
import { CopyIntegrationButton } from '@/app/(app)/workbench/integrations/copy-button'
import { auth } from '@/auth'
import { sessionUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

interface IssuePlanPageProps {
  searchParams: Promise<{ repo?: string; number?: string; plan?: string }>
}

export default async function IssuePlanPage({ searchParams }: IssuePlanPageProps) {
  const params = await searchParams
  const repo = params.repo?.trim() ?? ''
  const number = Number(params.number)
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')
  if (!repo || !Number.isFinite(number)) redirect('/workbench/maintain')

  const requestedPlan = Number(params.plan)
  const [latestReport, selectedReport, patches, handled] = await Promise.all([
    findLatestIssuePlan(getPool(), Number(currentUser.id), repo, number),
    Number.isFinite(requestedPlan) && requestedPlan > 0
      ? findIssuePlanById(getPool(), Number(currentUser.id), requestedPlan)
      : Promise.resolve(null),
    listPatchDrafts(getPool(), Number(currentUser.id), { repo, issueNumber: number, limit: 5 }),
    loadHandledState(getPool(), Number(currentUser.id)),
  ])
  const issueKey = `maintainer:${repo}:issue:${number}`.toLowerCase()
  const issueDone = handled.done.has(issueKey)
  const issueDismissed = handled.dismissed.has(issueKey)
  const latest = selectedReport ?? latestReport
  if (!latest) {
    return (
      <div className="page narrow">
        <p className="muted small">
          <Link href="/workbench/maintain">← 返回维护周报</Link>
        </p>
        <div className="empty">
          <p>还没有这个 Issue 的修复方案。</p>
          <p className="small">回到维护周报，在 Issue 待办里点「生成修复方案」。</p>
        </div>
      </div>
    )
  }

  const brief = buildIssuePlanBrief(latest)
  return (
    <div className="page narrow">
      <p className="muted small">
        <Link href="/workbench/maintain">← 返回维护周报</Link>
      </p>
      <section className="feed-head">
        <div>
          <p className="eyebrow">Issue 修复方案</p>
          <h1>
            {latest.repo} #{latest.issueNumber}
          </h1>
          <p className="feed-meta">{latest.issueTitle}</p>
        </div>
        <div className="feed-actions">
          <Link className="btn small" href="/library?tab=history&kind=issue-plan">
            历史生成
          </Link>
          <CopyIntegrationButton text={brief} label="复制修复任务书" className="btn small" />
          <form action={enqueuePatchAction}>
            <input type="hidden" name="repo" value={repo} />
            <input type="hidden" name="number" value={number} />
            <button className="btn small solid" type="submit">
              生成修复补丁
            </button>
          </form>
        </div>
      </section>

      {issueDone ? (
        <div className="notice">
          这个 Issue 已被标记为完成。复制修复任务书或生成补丁前，请确认是否还需要继续处理。
        </div>
      ) : null}
      {issueDismissed ? (
        <div className="notice">这个 Issue 已被标记为不感兴趣；如果要继续处理，可以直接忽略这条提示。</div>
      ) : null}

      <p className="muted small">
        {new Date(latest.generatedAt).toLocaleString('zh-CN')}
        {latest.model ? ` · ${latest.providerId ? `${latest.providerId} · ` : ''}${latest.model}` : ''}
        {selectedReport ? ' · 历史版本' : ''}
      </p>

      <section className="panel">
        <h2>问题判断</h2>
        <p className="muted">{latest.plan.summary}</p>
      </section>

      {latest.plan.likelyFiles.length > 0 ? (
        <section className="panel">
          <details className="collapsible-section" open={latest.plan.likelyFiles.length <= 5}>
            <summary className="collapsible-summary">
              <span>可能涉及的文件</span>
              <span className="muted small">{latest.plan.likelyFiles.length} 个</span>
            </summary>
          <ul className="issue-files">
            {latest.plan.likelyFiles.map((file) => (
              <li key={file}>
                <a
                  href={`https://github.com/${latest.repo}/blob/HEAD/${file}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {file}
                </a>
              </li>
            ))}
          </ul>
          </details>
        </section>
      ) : null}

      <section className="panel">
        <details className="collapsible-section" open={latest.plan.steps.length <= 4}>
          <summary className="collapsible-summary">
            <span>实现步骤</span>
            <span className="muted small">{latest.plan.steps.length} 步</span>
          </summary>
          <ol className="maintain-actions">
            {latest.plan.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </details>
      </section>

      <div className="maintain-columns">
        {latest.plan.tests.length > 0 ? (
          <section className="panel">
            <details className="collapsible-section" open={latest.plan.tests.length <= 3}>
              <summary className="collapsible-summary">
                <span>测试</span>
                <span className="muted small">{latest.plan.tests.length} 项</span>
              </summary>
              <ul className="maintain-list">
                {latest.plan.tests.map((test) => (
                  <li key={test}>{test}</li>
                ))}
              </ul>
            </details>
          </section>
        ) : null}
        {latest.plan.risks.length > 0 ? (
          <section className="panel">
            <details className="collapsible-section" open={latest.plan.risks.length <= 3}>
              <summary className="collapsible-summary">
                <span>风险</span>
                <span className="muted small">{latest.plan.risks.length} 项</span>
              </summary>
              <ul className="maintain-list">
                {latest.plan.risks.map((risk) => (
                  <li key={risk}>{risk}</li>
                ))}
              </ul>
            </details>
          </section>
        ) : null}
      </div>

      {latest.plan.acceptance.length > 0 ? (
        <section className="panel">
          <details className="collapsible-section" open={latest.plan.acceptance.length <= 3}>
            <summary className="collapsible-summary">
              <span>验收标准</span>
              <span className="muted small">{latest.plan.acceptance.length} 项</span>
            </summary>
            <ul className="maintain-list">
              {latest.plan.acceptance.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </details>
        </section>
      ) : null}

      <section className="panel">
        <h2>修复补丁</h2>
        {patches.length === 0 ? (
          <p className="muted small">
            还没有生成补丁。点击上方「生成修复补丁」，模型会输出 unified diff，并在 Docker 沙箱里验证能否应用和构建。
          </p>
        ) : (
          <ul className="maintain-list">
            {patches.map((patch) => (
              <li key={patch.id}>
                <Link href={`/patch/${patch.id}`}>
                  {new Date(patch.createdAt).toLocaleString('zh-CN')} ·{' '}
                  {patch.status === 'validated'
                    ? '已验证'
                    : patch.status === 'failed'
                      ? '验证未通过'
                      : '草稿'}
                </Link>
                {patch.summary ? <span className="muted small"> — {patch.summary.slice(0, 90)}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="muted small">
        方案由模型基于 Issue 和文件列表推断。修复补丁会单独生成，并在 Docker 沙箱中验证能否应用和构建；RepoRadar 不会自动提交、推送或开 PR。
      </p>
    </div>
  )
}
