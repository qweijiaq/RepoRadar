import Link from 'next/link'
import type { EnrichedRepoRecord } from '@repo-radar/core'
import { submitFeedbackAction } from '@/app/actions'

interface RepoCardProps {
  repo: EnrichedRepoRecord & { score?: number }
  showScore?: boolean
  feedback?: 'save' | 'hide'
  starred?: boolean
}

export function RepoCard({ repo, showScore = false, feedback, starred = false }: RepoCardProps) {
  const summary = repo.summary || repo.description || '暂无简介'

  return (
    <article className="repo-card">
      <header className="repo-card-head">
        <Link href={`/r/${repo.owner}/${repo.name}`} className="repo-name">
          {repo.fullName}
        </Link>
        <span className="repo-stars">★ {repo.stars.toLocaleString('en-US')}</span>
      </header>

      <p className="repo-summary">{summary}</p>

      {repo.reason ? <p className="repo-reason">为什么：{repo.reason}</p> : null}

      <footer className="repo-card-foot">
        <div className="chips">
          {repo.verifyStatus === 'verified' ? <span className="chip verified">已验证</span> : null}
          {repo.language ? <span className="chip">{repo.language}</span> : null}
          {repo.topics.slice(0, 3).map((topic) => (
            <span className="chip subtle" key={topic}>
              {topic}
            </span>
          ))}
        </div>
        {showScore && typeof repo.score === 'number' ? (
          <span className="score">{Math.round(repo.score * 100)} 分</span>
        ) : null}
      </footer>

      <div className="repo-actions">
        <form action={submitFeedbackAction}>
          <input type="hidden" name="repo" value={repo.fullName} />
          <input type="hidden" name="kind" value="save" />
          <button type="submit" className={feedback === 'save' ? 'pill active' : 'pill'}>
            {feedback === 'save' ? '已收藏' : '收藏'}
          </button>
        </form>
        <form action={submitFeedbackAction}>
          <input type="hidden" name="repo" value={repo.fullName} />
          <input type="hidden" name="kind" value="hide" />
          <button type="submit" className="pill">
            不感兴趣
          </button>
        </form>
        {starred ? <span className="pill static">已 star</span> : null}
      </div>
    </article>
  )
}
