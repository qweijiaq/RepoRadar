import Link from 'next/link'
import type { EnrichedRepoRecord, PersonalizedScoreBreakdown } from '@repo-radar/core'
import { submitFeedbackAction } from '@/app/actions'

interface RepoCardProps {
  repo: EnrichedRepoRecord & { score?: number }
  showScore?: boolean
  breakdown?: PersonalizedScoreBreakdown
  feedback?: 'save' | 'hide'
  starred?: boolean
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function signedPercent(value: number): string {
  const points = Math.round(value * 100)
  return points > 0 ? `+${points}%` : `${points}%`
}

export function RepoCard({ repo, showScore = false, breakdown, feedback, starred = false }: RepoCardProps) {
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

      {showScore && breakdown ? (
        <details className="score-detail">
          <summary>为什么是这个分数</summary>
          <ul>
            <li>
              <span>质量</span>
              <span>{percent(breakdown.global.contributions.quality * breakdown.weights.global)}</span>
            </li>
            <li>
              <span>新鲜度</span>
              <span>{percent(breakdown.global.contributions.newness * breakdown.weights.global)}</span>
            </li>
            <li>
              <span>增速</span>
              <span>{percent(breakdown.global.contributions.momentum * breakdown.weights.global)}</span>
            </li>
            {breakdown.affinity ? (
              <li>
                <span>个人匹配</span>
                <span>{percent(breakdown.affinity.contribution)}</span>
              </li>
            ) : null}
            {breakdown.adjustments.total !== 0 ? (
              <li>
                <span>反馈与订阅</span>
                <span>{signedPercent(breakdown.adjustments.total)}</span>
              </li>
            ) : null}
          </ul>
          <p className="muted small">评分版本 {breakdown.version}；总分 {percent(breakdown.total)}</p>
        </details>
      ) : null}

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
