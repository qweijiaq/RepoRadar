import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  buildTrendingText,
  findEnrichedRepos,
  getPool,
  loadRepoProfiles,
  loadTrendingCopy,
  rankVelocity,
  selectTrendingItems,
  templateTrendingCopy,
  trendingDateKey,
  toTrendingDetail,
  trendingDateLabel,
  type TrendingPost,
} from '@repo-radar/core'
import { generateMissingProfilesAction, generateTrendingPostAction } from '@/app/actions'
import { TrendingPoster } from '@/components/TrendingPoster'
import { auth } from '@/auth'
import { sessionUser } from '@/lib/session'

export const dynamic = 'force-dynamic'
export const metadata = { title: '分享卡 — RepoRadar' }

interface SharePageProps {
  searchParams: Promise<{ error?: string; generated?: string; profiles?: string }>
}

export default async function ShareTrendingPage({ searchParams }: SharePageProps) {
  const params = await searchParams
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')

  const pool = getPool()
  const dateKey = trendingDateKey()
  const repos = await findEnrichedRepos(pool, 500)
  const items = selectTrendingItems(repos, 10)
  const velocity = rankVelocity(repos, Date.now(), 3)
  const cached = await loadTrendingCopy(pool, dateKey)
  const profiles = await loadRepoProfiles(pool, items.map((item) => item.fullName))
  const details = items.map((item) => toTrendingDetail(item, profiles.get(item.fullName) ?? null))

  const post: TrendingPost = {
    dateKey,
    dateLabel: trendingDateLabel(),
    generatedAt: cached?.generatedAt ?? null,
    model: cached?.model ?? null,
    items,
    velocity,
    copy: cached?.copy ?? templateTrendingCopy(items),
  }
  const text = buildTrendingText(post, details)

  return (
    <div className="page narrow">
      <p className="breadcrumb">
        <Link href="/trends">← 返回趋势</Link>
      </p>

      <section className="feed-head">
        <div>
          <p className="eyebrow">分享卡</p>
          <h1>生成一张可以发的 GitHub 飙升榜</h1>
          <p className="feed-meta">
            按近 7 天 star 增量排序，AI 写标题和一句话介绍；可以复制文字发小红书，也可以导出 2x 海报图片。
            数据来自 RepoRadar 的每日 star 快照。
          </p>
        </div>
      </section>

      {params.error === 'llm' ? (
        <div className="notice">还没有配置 AI 模型，当前显示的是模板文案；配置后可生成更自然的版本。</div>
      ) : null}
      {params.error === 'empty' ? <div className="notice">还没有足够的 7 天快照。</div> : null}
      {params.generated ? <div className="notice success">文案已更新。</div> : null}

      {details.some((detail) => !detail.hasProfile) ? (
        <div className="notice">
          有 {details.filter((detail) => !detail.hasProfile).length} 个仓库还没有功能画像，详情页会缺少「它能做什么」。
          <form action={generateMissingProfilesAction}>
            <input type="hidden" name="target" value="share" />
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
        <form action={generateTrendingPostAction}>
          <button className="btn quiet small" type="submit">
            {cached ? '重新生成文案' : 'AI 生成文案'}
          </button>
        </form>
        <span className="muted small">
          {cached
            ? `文案由 ${cached.model ?? '模型'} 于 ${new Date(cached.generatedAt).toLocaleString('zh-CN')} 生成`
            : '还没有 AI 文案，当前是模板版本'}
        </span>
      </div>

      {items.length === 0 ? (
        <div className="notice">还没有足够的 7 天 star 快照，先积累几天数据再生成分享卡。</div>
      ) : (
        <TrendingPoster post={post} text={text} details={details} periodLabel="近 7 天" />
      )}
    </div>
  )
}
