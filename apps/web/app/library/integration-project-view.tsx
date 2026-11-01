import Link from 'next/link'
import { enqueueIntegrationProjectAction } from '@/app/jobs/enqueue'
import { CopyIntegrationButton } from '@/app/workbench/integrations/copy-button'
import type { LibraryStatus } from '@repo-radar/core'

export interface ProjectSuggestionView {
  repo: string
  status: LibraryStatus
  kind: 'missing' | 'optimize'
  action: 'try' | 'watch'
  reason: string
  steps: string[]
  alreadyUsed: boolean
  lastSeenAt: string
}

export interface IntegrationProjectGroup {
  project: string
  summary: string
  gaps: string[]
  pending: number
  adopted: number
  rejected: number
  lastSeenAt: string
  brief: string
  suggestions: ProjectSuggestionView[]
}

const STATUS_LABEL: Record<LibraryStatus, string> = {
  adopted: '已接入',
  rejected: '不感兴趣',
  pending: '待处理',
}

const STATUS_CLASS: Record<LibraryStatus, string> = {
  adopted: 'chip verified',
  rejected: 'chip subtle',
  pending: 'chip release',
}

export function IntegrationProjectView({ groups }: { groups: IntegrationProjectGroup[] }) {
  return (
    <>
      <div className="library-view-toggle">
        <Link className="chip toggle" href="/library?tab=integration&view=repo">
          按库查看
        </Link>
        <span className="chip toggle active">按维护项目</span>
      </div>

      {groups.length === 0 ? (
        <div className="empty">
          <p>还没有可用的历史接入建议。</p>
          <Link className="btn small" href="/workbench/integrations">
            生成接入建议
          </Link>
        </div>
      ) : (
        <div className="project-library-list">
          {groups.map((group) => (
            <article className="panel project-library-card" key={group.project}>
              <header className="project-library-head">
                <div>
                  <Link className="repo-name" href={`/r/${group.project}`}>
                    {group.project}
                  </Link>
                  <p className="muted small">
                    待处理 {group.pending} · 已接入 {group.adopted} · 不感兴趣 {group.rejected} · 最近{' '}
                    {new Date(group.lastSeenAt).toLocaleDateString('zh-CN')}
                  </p>
                </div>
                <div className="project-library-actions">
                  <Link
                    className="btn quiet small"
                    href={`/workbench/maintain/similar?repo=${encodeURIComponent(group.project)}`}
                  >
                    相似项目对比
                  </Link>
                  <form action={enqueueIntegrationProjectAction}>
                    <input type="hidden" name="project" value={group.project} />
                    <input
                      type="hidden"
                      name="returnTo"
                      value="/library?tab=integration&view=project"
                    />
                    <button className="btn quiet small" type="submit">
                      重新生成这个库
                    </button>
                  </form>
                  {group.pending > 0 ? (
                    <CopyIntegrationButton
                      text={group.brief}
                      label={`复制给 AI（${group.pending} 条待处理）`}
                      className="btn small"
                    />
                  ) : (
                    <span className="chip verified">全部已处理</span>
                  )}
                </div>
              </header>
              <p className="muted">{group.summary}</p>
              {group.gaps.length > 0 ? (
                <div className="chips">
                  {group.gaps.map((gap) => (
                    <span className="chip" key={gap}>
                      {gap}
                    </span>
                  ))}
                </div>
              ) : null}
              {group.suggestions.length > 0 ? (
                <details className="collapsible-section" open={group.suggestions.length <= 3}>
                  <summary className="collapsible-summary">
                    <span>历史建议</span>
                    <span className="muted small">{group.suggestions.length} 个库</span>
                  </summary>
                  <ul className="integration-suggestions">
                    {group.suggestions.map((suggestion) => (
                      <li key={suggestion.repo}>
                        <div className="suggestion-head">
                          <Link href={`/r/${suggestion.repo}`}>{suggestion.repo}</Link>
                          <span className={STATUS_CLASS[suggestion.status]}>
                            {STATUS_LABEL[suggestion.status]}
                          </span>
                          <span className="chip subtle">
                            {suggestion.kind === 'missing' ? '缺失功能' : '可优化'}
                          </span>
                        </div>
                        <p className="muted small">{suggestion.reason}</p>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </>
  )
}
