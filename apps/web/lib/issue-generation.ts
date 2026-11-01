import {
  buildFeedbackContext,
  diversifyRanking,
  findEnrichedRepos,
  generateIssueDraft,
  groupEvidence,
  handledRepoNames,
  listFeedbackSignals,
  loadFeedback,
  loadHandledState,
  loadReleaseEvents,
  loadSubscriptions,
  loadUserStars,
  rankForUser,
  renderDraftHtml,
  renderDraftMarkdown,
  repoEvidence,
  risingRepos,
  summarizeProfile,
  type IssueEvidence,
  type IssueReleaseEvidence,
  type LlmConfig,
} from '@repo-radar/core'
import { getPool } from './db'
import { findUserById } from './users'

const DAY_MS = 86_400_000

export interface GeneratedIssue {
  title: string
  summary: string[]
  html: string
  markdown: string
}

export async function generateIssueForUser(userId: number, llm: LlmConfig): Promise<GeneratedIssue> {
  const pool = getPool()
  const user = await findUserById(userId)
  if (!user) throw new Error('用户不存在')

  const [allRepos, feedback, signals, subscriptions, starred, handled] = await Promise.all([
    findEnrichedRepos(pool, 500),
    loadFeedback(pool, userId),
    listFeedbackSignals(pool, userId),
    loadSubscriptions(pool, userId),
    loadUserStars(pool, userId),
    loadHandledState(pool, userId),
  ])
  const hiddenNames = handledRepoNames(handled)
  const repos = allRepos.filter((repo) => !hiddenNames.has(repo.fullName.toLowerCase()))
  if (repos.length === 0) throw new Error('还没有可用的已富化仓库，先运行采集与富化')

  const context = buildFeedbackContext(feedback, signals)
  const ranked = rankForUser(user.profile, repos, Date.now(), context, subscriptions)
  const candidates = diversifyRanking(ranked, { limit: 18 })
  const groups = groupEvidence(candidates, user.profile, 4, 4)

  const watched = subscriptions.filter((sub) => sub.kind === 'release').map((sub) => sub.value)
  const targets = [...new Set([...starred, ...watched, ...candidates.map((repo) => repo.fullName)])]
    .filter((name) => !hiddenNames.has(name.toLowerCase()))
    .slice(0, 24)
  const events = await loadReleaseEvents(pool, targets, 16)
  const now = Date.now()
  const releases: IssueReleaseEvidence[] = events.map((event) => {
    const published = event.publishedAt
    return {
      ...event,
      isNew: published ? now - Date.parse(published) <= 7 * DAY_MS : false,
      isStarred: starred.has(event.repoFullName),
    }
  })

  const evidence: IssueEvidence = {
    userName: user.login,
    date: new Date(),
    windowDays: 7,
    totalCandidates: repos.length,
    profile: summarizeProfile(user.profile),
    releases,
    groups,
    rising: risingRepos(repos, 5).map((repo) => ({ ...repoEvidence(repo), growth: repo.growth })),
  }

  const draft = await generateIssueDraft(evidence, llm)
  return {
    title: draft.title,
    summary: draft.summary,
    html: renderDraftHtml(draft, evidence),
    markdown: renderDraftMarkdown(draft, evidence),
  }
}
