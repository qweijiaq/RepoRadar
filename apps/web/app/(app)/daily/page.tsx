import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  buildTrendingText,
  dailyTemplateCopy,
  getPool,
  loadDailyRanking,
  loadRepoProfiles,
  loadTrendingCopy,
  toTrendingDetail,
  type TrendingPost,
} from '@repo-radar/core'
import { generateDailyCopyAction, generateMissingProfilesAction } from '@/app/actions'
import { TrendingPoster } from '@/components/TrendingPoster'
import { auth } from '@/auth'
import { sessionUser } from '@/lib/session'

export const dynamic = 'force-dynamic'
export const metadata = { title: '每日榜单 — RepoRadar' }

interface DailyPageProps {
  searchParams: Promise<{ error?: string; generated?: string; profiles?: string }>
}

export default async function DailyPage({ searchParams }: DailyPageProps) {
  const params = await searchParams
  const session = await auth()
  if (!sessionUser(session)) redirect('/login')

  const pool = getPool()
  const ranking = await loadDailyRanking(pool, 10)
  const cached = await loadTrendingCopy(pool, ranking.dateKey, 'daily')
  const profiles = await loadRepoProfiles(pool, ranking.items.map((item) => item.fullName))
  const details = ranking.items.map((item) =>
    toTrendingDetail(item, profiles.get(item.fullName) ?? null),
  )

  const post: TrendingPost = {
    dateKey: ranking.dateKey,
    dateLabel: ranking.dateLabel,
    generatedAt: cached?.generatedAt ?? null,
    model: cached?.model ?? null,
    items: ranking.items,
    velocity: [],
    copy: cached?.copy ?? dailyTemplateCopy(ranking),
  }
  const text = buildTrendingText(post, details)

  return (
    <div className="page narrow">
      <p className="breadcrumb">
        <Link href="/trends">← 返回趋势</Link>
      </p>

      <section className="feed-head">
        <div>
          <p className="eyebrow">每日榜单</p>
          <h1>GitHub 每日飙升 Top10</h1>
          <p className="feed-meta">
            按「当前 star − 上一次快照」排序。快照每天记录一次；如果上次快照不是昨天，会标记为多日增量。
            可以复制文字或导出图片。
          </p>
        </div>
      </section>

      {params.error === 'empty' ? (
        <div className="notice">还没有可比较的快照，先跑一次 `pnpm radar snapshot`。</div>
      ) : null}
      {params.error === 'llm' ? (
        <div className="notice">还没有配置 AI 模型，当前使用模板文案。</div>
      ) : null}
      {params.generated ? <div className="notice success">每日文案已更新。</div> : null}

      {details.some((detail) => !detail.hasProfile) ? (
        <div className="notice">
          有 {details.filter((detail) => !detail.hasProfile).length} 个仓库还没有功能画像，详情页会缺少「它能做什么」。
          <form action={generateMissingProfilesAction}>
            <input type="hidden" name="target" value="daily" />
            <button className="btn quiet small" type="submit">
              补全 3 个画像
            </button>
          </form>
        </div>
      ) : null}
      {params.profiles ? <div className="notice success">功能画像已补全一部分；还有缺失可以再点一次。</div> : null}
      {params.error === 'need-token' ? (
        <div className="notice">补全画像需要 GitHub 授权，请重新登录后再试。</div>
      ) : null}
      {params.error === 'llm' ? <div className="notice">还没有配置 AI 模型。</div> : null}

      <div className="feed-actions">
        <form action={generateDailyCopyAction}>
          <button className="btn quiet small" type="submit">
            {cached ? '重新生成文案' : 'AI 生成文案'}
          </button>
        </form>
        <span className="muted small">
          {ranking.basis === 'day'
            ? '对比昨天快照'
            : `对比 ${ranking.previousDate ?? '上一次快照'}（多日增量）`}
          {cached ? ` · 文案由 ${cached.model ?? '模型'} 生成` : ''}
        </span>
      </div>

      {ranking.items.length === 0 ? (
        <div className="notice">
          还没有可比较的快照。先运行 <code>pnpm radar snapshot</code>，明天开始就能看到真正的每日榜。
        </div>
      ) : (
        <TrendingPoster post={post} text={text} details={details} periodLabel="今日" />
      )}
    </div>
  )
}
