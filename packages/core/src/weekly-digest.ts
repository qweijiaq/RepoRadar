import type { DbPool } from './db.js'
import { findEnrichedRepos } from './db.js'
import type { DigestItem, DigestOptions } from './digest.js'
import { renderDigestHtml, renderDigestMarkdown } from './digest.js'
import { diversifyRanking } from './diversity.js'
import { loadFeedback, listFeedbackSignals } from './feedback.js'
import { handledRepoNames, loadHandledState } from './handled.js'
import { buildFeedbackContext, rankForUser } from './personalize.js'
import { loadSubscriptions } from './subscriptions.js'
import type { UserRecord } from './users.js'

export interface WeeklyDigest {
  subject: string
  text: string
  html: string
  items: DigestItem[]
}

export async function buildWeeklyDigest(
  pool: DbPool,
  user: UserRecord,
  options: { limit?: number; baseUrl?: string; date?: Date } = {},
): Promise<WeeklyDigest> {
  const date = options.date ?? new Date()
  const limit = Math.max(1, Math.min(20, options.limit ?? 10))
  const [allRepos, feedback, signals, subscriptions, handled] = await Promise.all([
    findEnrichedRepos(pool, 500),
    loadFeedback(pool, user.id),
    listFeedbackSignals(pool, user.id),
    loadSubscriptions(pool, user.id),
    loadHandledState(pool, user.id),
  ])
  const hiddenNames = handledRepoNames(handled)
  const repos = allRepos.filter((repo) => !hiddenNames.has(repo.fullName.toLowerCase()))
  const context = buildFeedbackContext(feedback, signals)
  const ranked = rankForUser(user.profile, repos, date.getTime(), context, subscriptions)
  const diverse = diversifyRanking(ranked, { limit })
  const items: DigestItem[] = diverse.map((repo) => ({
    fullName: repo.fullName,
    htmlUrl: repo.htmlUrl,
    stars: repo.stars,
    language: repo.language,
    summary: repo.summary,
    reason: repo.reason,
    score: repo.score,
  }))
  const digestOptions: DigestOptions = {
    items,
    userName: user.login,
    date,
    baseUrl: options.baseUrl,
  }
  return {
    subject: `RepoRadar 每周精选 — ${date.toISOString().slice(0, 10)}`,
    text: renderDigestMarkdown(digestOptions),
    html: renderDigestHtml(digestOptions),
    items,
  }
}
