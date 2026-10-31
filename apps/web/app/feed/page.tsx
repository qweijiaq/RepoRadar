import Link from 'next/link'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import {
  buildFeedbackContext,
  buildFeedOpportunities,
  discoverHiddenGems,
  diversifyRanking,
  findEnrichedRepos,
  findLatestIntegrationReport,
  findLatestMaintainerReport,
  groupByProfileTopic,
  hiddenGemsFromLibrary,
  listFeedDismissals,
  listFeedImpressions,
  listFeedStatuses,
  listFeedbackSignals,
  listIntegrationOutcomes,
  listUserProjects,
  listWatchIntents,
  listWatchMatches,
  loadFeedback,
  loadRecentReleaseRepoNames,
  loadReleaseEvents,
  loadSubscriptions,
  loadUserStars,
  OPPORTUNITY_LABEL,
  RADAR_MODES,
  isRadarMode,
  recordFeedImpressions,
  radarPersona,
  rankForUser,
  risingRepos,
  type FeedOpportunity,
  type HiddenGem,
  type OpportunityKind,
  type RadarMode,
} from '@repo-radar/core'
import { auth } from '@/auth'
import { RepoCard } from '@/components/RepoCard'
import { getPool } from '@/lib/db'
import { findLatestIssueDraft } from '@/lib/issue-drafts'
import { resolveGithubToken, sessionUser } from '@/lib/session'
import { findUserById } from '@/lib/users'
import { markFeedItemDoneAction, setRadarModeAction } from './actions'
import { FeedDismissButton } from './dismiss-button'
import { RefreshFeedButton } from './refresh-button'
import { createRadarShareAction } from './share-action'

export const dynamic = 'force-dynamic'

interface FeedFilters {
  verified: boolean
  release: boolean
  rising: boolean
  language: string
}

interface FeedPageProps {
  searchParams: Promise<{
    tab?: string
    mode?: string
    refresh?: string
    seed?: string
    verified?: string
    release?: string
    rising?: string
    language?: string
  }>
}

function buildFilterHref(filters: FeedFilters, overrides: Partial<Record<keyof FeedFilters, string | null>>): string {
  const next: FeedFilters = { ...filters }
  for (const [key, value] of Object.entries(overrides) as Array<[keyof FeedFilters, string | null]>) {
    if (key === 'language') next.language = value ?? ''
    else next[key] = value === '1' || value === null ? value === '1' : false
  }

  const params = new URLSearchParams({ tab: 'library' })
  if (next.verified) params.set('verified', '1')
  if (next.release) params.set('release', '1')
  if (next.rising) params.set('rising', '1')
  if (next.language) params.set('language', next.language)
  return `/feed?${params.toString()}`
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

function rotateGems(gems: HiddenGem[], seed: number, count = 3): HiddenGem[] {
  if (gems.length <= count) return gems.slice(0, count)
  const offset = (seed * count) % gems.length
  return Array.from({ length: count }, (_, index) => gems[(offset + index) % gems.length]!).filter(Boolean)
}

const MODE_HEADLINE: Record<RadarMode, string> = {
  balanced: '今天值得看的几件事',
  focus: '先把项目往前推',
  swap: '换掉不顺手的工具',
  explore: '跳出当前栈看看',
  new: '最近冒出来的项目',
}

const MODE_OPPORTUNITY_KINDS: Record<RadarMode, OpportunityKind[] | undefined> = {
  balanced: undefined,
  focus: ['maintainer', 'dependency', 'integration'],
  swap: ['dependency', 'integration'],
  explore: ['watch', 'integration'],
  new: [],
}

export default async function FeedPage({ searchParams }: FeedPageProps) {
  const params = await searchParams
  const requestHeaders = await headers()
  const hardRefresh = /no-cache|max-age=0/i.test(requestHeaders.get('cache-control') ?? '')
  const tab = params.tab === 'library' ? 'library' : 'radar'
  const seed = Math.max(0, Number.parseInt(params.seed ?? '0', 10) || 0)
  const session = await auth()
  const sessionInfo = sessionUser(session)
  if (!sessionInfo) redirect('/login')

  const filters: FeedFilters = {
    verified: params.verified === '1',
    release: params.release === '1',
    rising: params.rising === '1',
    language: params.language ?? '',
  }
  const hasFilters = filters.verified || filters.release || filters.rising || Boolean(filters.language)
  const isLibrary = tab === 'library'
  const returnTo = isLibrary ? '/feed?tab=library' : `/feed?seed=${seed}`

  const userId = Number(sessionInfo.id)
  const pool = getPool()
  const [user, repos, feedback, signals, starred, subscriptions, latestDraft] = await Promise.all([
    findUserById(userId),
    findEnrichedRepos(pool, 500),
    loadFeedback(pool, userId),
    listFeedbackSignals(pool, userId),
    loadUserStars(pool, userId),
    loadSubscriptions(pool, userId),
    findLatestIssueDraft(pool, userId),
  ])
  const recentReleaseNames = await loadRecentReleaseRepoNames(pool, 7)

  const profile = user?.profile ?? null
  const context = buildFeedbackContext(feedback, signals)
  const filteredRepos = repos.filter((repo) => {
    if (filters.verified && repo.verifyStatus !== 'verified') return false
    if (filters.release && !recentReleaseNames.has(repo.fullName)) return false
    if (filters.rising && !(repo.stars7d !== null && repo.stars > repo.stars7d)) return false
    if (filters.language && repo.language !== filters.language) return false
    return true
  })
  const ranked = rankForUser(profile, filteredRepos, Date.now(), context, subscriptions)
  const diversified = diversifyRanking(ranked, { limit: 30 })
  const groups = groupByProfileTopic(diversified, profile, { maxGroups: 4, perGroup: 8 })
  const savedCount = [...feedback.values()].filter((kind) => kind === 'save').length
  const hiddenCount = feedback.size - savedCount
  const topTopics = Object.entries(profile?.topicWeights ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
  const languageOptions = Object.entries(profile?.languageWeights ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([language]) => language)
  const radarMode: RadarMode =
    (isRadarMode(params.mode) ? params.mode : user?.prefs.radarMode) ?? 'balanced'
  const modeInfo = RADAR_MODES.find((mode) => mode.value === radarMode) ?? RADAR_MODES[0]!
  let persona = radarPersona([])

  const watched = subscriptions.filter((sub) => sub.kind === 'release').map((sub) => sub.value)
  const releases = isLibrary ? await loadReleaseEvents(pool, watched, 5) : []
  const watchedSet = new Set([...starred, ...watched])
  const releaseCount = [...recentReleaseNames].filter((name) => watchedSet.has(name)).length
  const topRising = risingRepos(repos, 1)[0]
  const briefItems =
    latestDraft && latestDraft.summary.length > 0
      ? latestDraft.summary.slice(0, 3)
      : [
          releaseCount > 0
            ? `你关注的项目本周有 ${releaseCount} 个新版本。`
            : '本周关注的项目暂时没有新版本。',
          topRising
            ? `上升最快的是 ${topRising.fullName}（7 天 +${(topRising.growth * 100).toFixed(1)}%）。`
            : 'star 增速还在积累，日常采集几天后会更有信号。',
          profile
            ? `画像来自 ${profile.sourceCounts?.stars ?? profile.starredCount} 个 star、${profile.sourceCounts?.owned ?? 0} 个活跃仓库和 ${profile.sourceCounts?.events ?? 0} 个近期事件。`
            : '还没有建立口味画像，先去设置页同步 GitHub。',
        ]

  let opportunities: FeedOpportunity[] = []
  let gems: HiddenGem[] = []
  let gemPoolSize = 0
  let strictFeedback = false

  if (!isLibrary) {
    const [maintainer, integration, dismissals, statuses, outcomes, impressions, projects, intents] = await Promise.all([
      findLatestMaintainerReport(pool, userId),
      findLatestIntegrationReport(pool, userId),
      listFeedDismissals(pool, userId),
      listFeedStatuses(pool, userId),
      listIntegrationOutcomes(pool, userId),
      listFeedImpressions(pool, userId),
      listUserProjects(pool, userId),
      listWatchIntents(pool, userId),
    ])
    const dismissedKeys = new Set([
      ...dismissals.map((item) => item.key),
      ...statuses.map((item) => item.key),
      ...outcomes.map(
        (outcome) => `integration:${outcome.projectFullName}:${outcome.suggestionRepo}`,
      ),
    ])
    const dismissedNames = new Set(
      [
        ...impressions,
        ...dismissals
          .filter((item) => item.kind === 'gem' && item.key.startsWith('gem:'))
          .map((item) => item.key.slice(4)),
        ...statuses
          .filter((item) => item.kind === 'gem' && item.key.startsWith('gem:'))
          .map((item) => item.key.slice(4)),
      ].map((name) => name.toLowerCase()),
    )
    const reasonCounts = dismissals.reduce<Record<string, number>>((counts, item) => {
      counts[item.reason] = (counts[item.reason] ?? 0) + 1
      return counts
    }, {})

    const watch = await Promise.all(
      intents
        .filter((intent) => intent.active)
        .map(async (intent) => ({ intent, matches: await listWatchMatches(pool, intent.id) })),
    )
    opportunities = buildFeedOpportunities({
      maintainer,
      integration,
      watch,
      dismissed: dismissedKeys,
      kinds: MODE_OPPORTUNITY_KINDS[radarMode],
      limit: radarMode === 'explore' ? 2 : 3,
    })

    const activeProjects = projects.filter((project) => project.active)
    persona = radarPersona(activeProjects)
    const projectLanguages = unique(activeProjects.map((project) => project.language))
    const projectTopics = unique(activeProjects.flatMap((project) => project.topics))
    const profileLanguages = languageOptions
    const profileTopics = topTopics.map(([topic]) => topic)
    const exploreMode = radarMode === 'explore' || radarMode === 'new'
    const languages = (
      exploreMode && profileLanguages.length > 0
        ? profileLanguages
        : projectLanguages.length > 0
          ? projectLanguages
          : profileLanguages
    ).slice(0, 3)
    const topics = (
      exploreMode && profileTopics.length > 0
        ? profileTopics
        : projectTopics.length > 0
          ? projectTopics
          : profileTopics
    ).slice(0, 3)
    const gemCount = radarMode === 'focus' ? 1 : 3
    const known = new Set(
      [...starred, ...projects.map((project) => project.repoFullName), ...feedback.keys()].map((name) =>
        name.toLowerCase(),
      ),
    )

    strictFeedback = Object.keys(reasonCounts).length > 0
    const gemContext = {
      languages,
      topics,
      exclude: new Set([...known, ...dismissedNames]),
      requireLanguage:
        radarMode !== 'explore' &&
        radarMode !== 'new' &&
        (reasonCounts['not-my-stack'] ?? 0) > 0 &&
        languages.length > 0,
      requireTopic:
        radarMode !== 'explore' &&
        radarMode !== 'new' &&
        (reasonCounts['too-broad'] ?? 0) > 0 &&
        topics.length > 0,
      maxAgeDays: radarMode === 'new' ? 365 : undefined,
      sort: radarMode === 'new' ? ('fresh' as const) : ('score' as const),
      fresh: Boolean(params.refresh) || hardRefresh,
      limit: 18,
    }

    const token = resolveGithubToken(session)?.token ?? null
    const searchGems = await discoverHiddenGems(token, gemContext)
    const libraryGems = hiddenGemsFromLibrary(repos, gemContext)
    const merged = new Map<string, HiddenGem>()
    for (const gem of [...searchGems, ...libraryGems]) {
      if (!merged.has(gem.repo.fullName.toLowerCase())) merged.set(gem.repo.fullName.toLowerCase(), gem)
    }
    const allGems = [...merged.values()]
      .filter((gem) => !dismissedKeys.has(`gem:${gem.repo.fullName}`))
      .sort((left, right) => {
        if (radarMode === 'new') {
          return (Date.parse(right.repo.createdAt ?? '') || 0) - (Date.parse(left.repo.createdAt ?? '') || 0)
        }
        return right.score - left.score
      })
    gemPoolSize = allGems.length
    gems = rotateGems(allGems, seed, gemCount)
    if (gems.length > 0 && gemPoolSize > gems.length) {
      await recordFeedImpressions(pool, userId, gems.map((gem) => gem.repo.fullName))
    }
  }

  const shareSnapshot = JSON.stringify({
    mode: radarMode,
    persona,
    opportunities: opportunities.map((item) => ({
      kind: item.kind,
      title: item.title,
      detail: item.detail,
      evidence: item.evidence,
      repo: item.repo,
    })),
    gems: gems.map((gem) => ({
      repo: gem.repo.fullName,
      description: gem.repo.description ?? '',
      stars: gem.repo.stars,
      language: gem.repo.language,
      reasons: gem.reasons,
      htmlUrl: gem.repo.htmlUrl,
    })),
  })

  const nextSeed = seed + 1

  return (
    <div className="page">
      <section className="feed-head">
        <div>
          <p className="eyebrow">你的雷达</p>
          <h1>{isLibrary ? '工具库' : MODE_HEADLINE[radarMode]}</h1>
          <p className="feed-meta">
            {isLibrary
              ? '按画像和标签浏览全部已收录项目；这里适合你已经知道自己要找什么的时候。'
              : `${modeInfo.description}。${profile ? `基于 ${profile.sourceCounts?.stars ?? profile.starredCount} 个 star${activeLabel(profile.sourceCounts?.owned)}` : ''}`}
          </p>
          {!isLibrary ? (
            <>
              <p className="radar-persona">
                雷达人格：<strong>{persona.name}</strong> · {persona.detail}
              </p>
              <div className="radar-mode-bar">
                {RADAR_MODES.map((mode) => (
                  <form action={setRadarModeAction} key={mode.value}>
                    <input type="hidden" name="mode" value={mode.value} />
                    <button
                      type="submit"
                      className={mode.value === radarMode ? 'mode-chip active' : 'mode-chip'}
                    >
                      {mode.label}
                    </button>
                  </form>
                ))}
              </div>
            </>
          ) : null}
          <div className="feed-tabs">
            <Link className={!isLibrary ? 'feed-tab active' : 'feed-tab'} href="/feed">
              精选
            </Link>
            <Link className={isLibrary ? 'feed-tab active' : 'feed-tab'} href="/feed?tab=library">
              工具库
            </Link>
          </div>
        </div>
        <div className="feed-actions">
          {isLibrary ? (
            <>
              <RefreshFeedButton label="刷新列表" />
              <Link className="btn solid small" href="/issue">
                生成周报
              </Link>
              <Link className="btn small" href="/trends">
                趋势
              </Link>
              <Link className="btn small" href="/settings">
                调整口味
              </Link>
            </>
          ) : (
            <>
              <RefreshFeedButton />
              <form action={createRadarShareAction}>
                <input type="hidden" name="snapshot" value={shareSnapshot} />
                <button className="btn quiet small" type="submit">
                  分享雷达
                </button>
              </form>
              <Link className="btn solid small" href="/copilot">
                问雷达
              </Link>
              <Link className="btn small" href="/watch">
                调整目标
              </Link>
              <Link className="btn small" href="/maintain">
                维护周报
              </Link>
            </>
          )}
        </div>
      </section>

      {isLibrary ? (
        <>
          {topTopics.length > 0 ? (
            <div className="chips">
              {topTopics.map(([topic, weight]) => (
                <span className="chip" key={topic}>
                  {topic} · {Math.round(weight * 100)}%
                </span>
              ))}
            </div>
          ) : null}

          <section className="brief-panel">
            <div className="brief-head">
              <span className="eyebrow">今日简报</span>
              <Link className="btn quiet small" href="/issue">
                {latestDraft ? '阅读完整周报' : '生成周报'}
              </Link>
            </div>
            <ol className="brief-list">
              {briefItems.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ol>
            {latestDraft ? <p className="brief-source">来自《{latestDraft.title}》</p> : null}
          </section>

          {releases.length > 0 ? (
            <section className="update-panel">
              <h2>关注项目的更新</h2>
              <ul className="update-list">
                {releases.map((event) => (
                  <li key={`${event.repoFullName}:${event.tag}`}>
                    <a href={event.url ?? '#'} target="_blank" rel="noreferrer">
                      {event.repoFullName} {event.tag}
                    </a>
                    {event.publishedAt ? (
                      <span className="update-tag">
                        {new Date(event.publishedAt).toLocaleDateString('zh-CN')}
                      </span>
                    ) : null}
                    {event.name ? <span className="muted small">{event.name}</span> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <div className="filter-bar">
            <span className="filter-label">筛选</span>
            <Link
              className={filters.verified ? 'chip toggle active' : 'chip toggle'}
              href={buildFilterHref(filters, { verified: filters.verified ? null : '1' })}
            >
              已验证
            </Link>
            <Link
              className={filters.release ? 'chip toggle active' : 'chip toggle'}
              href={buildFilterHref(filters, { release: filters.release ? null : '1' })}
            >
              有新版本
            </Link>
            <Link
              className={filters.rising ? 'chip toggle active' : 'chip toggle'}
              href={buildFilterHref(filters, { rising: filters.rising ? null : '1' })}
            >
              上升中
            </Link>
            {languageOptions.map((language) => (
              <Link
                key={language}
                className={filters.language === language ? 'chip toggle active' : 'chip toggle'}
                href={buildFilterHref(filters, { language: filters.language === language ? null : language })}
              >
                {language}
              </Link>
            ))}
            {hasFilters ? (
              <Link className="chip toggle" href="/feed?tab=library">
                清除
              </Link>
            ) : null}
            <span className="filter-count">{diversified.length} 个结果</span>
          </div>

          <p className="muted small">
            已收藏 {savedCount} · 已隐藏 {hiddenCount}
          </p>

          {diversified.length === 0 ? (
            <div className="empty">
              <p>没有符合筛选条件的仓库。</p>
              <p className="small">试试清除筛选，或等下一轮采集/富化。</p>
            </div>
          ) : (
            groups.map((group) => (
              <section className="topic-group" key={group.topic}>
                <div className="topic-head">
                  <h2>{group.topic}</h2>
                  <span>{group.repos.length} 个</span>
                </div>
                <div className="repo-grid">
                  {group.repos.map((repo) => (
                    <RepoCard
                      key={repo.fullName}
                      repo={repo}
                      showScore
                      feedback={feedback.get(repo.fullName)}
                      starred={starred.has(repo.fullName)}
                    />
                  ))}
                </div>
              </section>
            ))
          )}
        </>
      ) : (
        <>
          {radarMode !== 'new' ? (
            <section className="radar-section">
              <div className="radar-section-head">
                <div>
                  <h2>
                    {radarMode === 'focus'
                      ? '先处理这些'
                      : radarMode === 'swap'
                        ? '工具链机会'
                        : radarMode === 'explore'
                          ? '值得顺藤摸瓜的线索'
                          : '今天能推进的事'}
                  </h2>
                  <p className="muted small">
                    {radarMode === 'explore'
                      ? '不一定直接相关，但可能打开新的方向。'
                      : '来自维护周报、接入建议和你的关注代理，不是按标签挑仓库。'}
                  </p>
                </div>
                <span className="radar-count">{opportunities.length} 条</span>
              </div>
              {opportunities.length > 0 ? (
                <div className="opportunity-grid">
                  {opportunities.map((opportunity) => (
                    <article className="opportunity-card" key={opportunity.key}>
                      <div className="opportunity-head">
                        <span className={`chip ${opportunity.kind === 'dependency' ? 'release' : 'used'}`}>
                          {OPPORTUNITY_LABEL[opportunity.kind]}
                        </span>
                        <span className="muted small">{opportunity.evidence[0]}</span>
                      </div>
                      <h3>{opportunity.title}</h3>
                      <p className="muted">{opportunity.detail}</p>
                      <div className="chips">
                        {opportunity.evidence.slice(1).map((evidence) => (
                          <span className="chip subtle" key={evidence}>
                            {evidence}
                          </span>
                        ))}
                      </div>
                      <div className="opportunity-actions">
                        <Link className="btn small" href={opportunity.href}>
                          去处理
                        </Link>
                        {opportunity.repo ? (
                          <a
                            className="btn quiet small"
                            href={`https://github.com/${opportunity.repo}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            看项目
                          </a>
                        ) : null}
                        <FeedDismissButton
                          itemKey={opportunity.key}
                          kind={opportunity.kind}
                          returnTo={returnTo}
                        />
                        <form action={markFeedItemDoneAction} className="inline-form">
                          <input type="hidden" name="itemKey" value={opportunity.key} />
                          <input type="hidden" name="kind" value={opportunity.kind} />
                          <input type="hidden" name="returnTo" value={returnTo} />
                          <button className="btn quiet small" type="submit">
                            标记完成
                          </button>
                        </form>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="radar-empty">
                  <p>这个模式下暂时没有可以推进的事。</p>
                  <p className="small">
                    切回「综合」，或者先让 AI 看一眼你的项目。
                  </p>
                  <div className="radar-empty-actions">
                    <Link className="btn small" href="/maintain">
                      生成维护周报
                    </Link>
                    <Link className="btn small" href="/integrations">
                      生成接入建议
                    </Link>
                  </div>
                </div>
              )}
            </section>
          ) : null}

          <section className="radar-section">
            <div className="radar-section-head">
              <div>
                <h2>
                  {radarMode === 'focus'
                    ? '顺带看一眼'
                    : radarMode === 'new'
                      ? '最近冒出来的项目'
                      : radarMode === 'explore'
                        ? '可能打开新方向的项目'
                        : radarMode === 'swap'
                          ? '工具链候选'
                          : '隐藏宝石'}
                </h2>
                <p className="muted small">
                  {radarMode === 'new'
                    ? '创建于最近一年、仍在活跃更新，优先排除大厂和清单类项目。'
                    : '小而活跃、和你正在做的事相关；已排除大厂官方仓库和清单/教程类项目。'}
                  {strictFeedback && radarMode !== 'explore' && radarMode !== 'new'
                    ? ' 已根据你的「不感兴趣」原因收紧筛选。'
                    : ''}
                </p>
              </div>
              <div className="radar-section-actions">
                <span className="radar-count">{gemPoolSize} 个候选</span>
                {gemPoolSize > gems.length ? (
                  <Link className="btn quiet small" href={`/feed?seed=${nextSeed}`}>
                    换一批
                  </Link>
                ) : null}
              </div>
            </div>
            {gems.length > 0 ? (
              <div className="gem-grid">
                {gems.map((gem) => (
                  <article className="gem-card" key={gem.repo.fullName}>
                    <div className="gem-head">
                      <a href={gem.repo.htmlUrl} target="_blank" rel="noreferrer" className="repo-name">
                        {gem.repo.fullName}
                      </a>
                      <span className="repo-stars">★ {gem.repo.stars}</span>
                    </div>
                    <p className="gem-desc">{gem.repo.description || '暂无描述'}</p>
                    <div className="chips">
                      {gem.reasons.map((reason) => (
                        <span className="chip used" key={reason}>
                          {reason}
                        </span>
                      ))}
                    </div>
                    <div className="gem-foot">
                      <span className="muted small">
                        {gem.repo.language ?? '未知语言'} · {gem.source === 'search' ? '刚发现' : '已收录'}
                      </span>
                      <div className="gem-actions">
                        {gem.source === 'library' ? (
                          <Link className="btn quiet small" href={`/r/${gem.repo.fullName}`}>
                            详情
                          </Link>
                        ) : (
                          <a
                            className="btn quiet small"
                            href={gem.repo.htmlUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            GitHub
                          </a>
                        )}
                        <FeedDismissButton
                          itemKey={`gem:${gem.repo.fullName}`}
                          kind="gem"
                          returnTo={returnTo}
                        />
                        <form action={markFeedItemDoneAction} className="inline-form">
                          <input type="hidden" name="itemKey" value={`gem:${gem.repo.fullName}`} />
                          <input type="hidden" name="kind" value="gem" />
                          <input type="hidden" name="returnTo" value={returnTo} />
                          <button className="btn quiet small" type="submit">
                            已接入
                          </button>
                        </form>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="radar-empty">
                <p>暂时没有发现足够可靠的隐藏宝石。</p>
                <p className="small">
                  配置 GitHub token 后会现场搜索；也可以先在趋势页或采集任务里补充候选。
                </p>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function activeLabel(owned: number | undefined): string {
  return owned ? ` + ${owned} 个活跃仓库` : ''
}
