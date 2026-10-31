import {
  buildFeedbackContext,
  diversifyRanking,
  findEnrichedRepos,
  generateIssueDraft,
  groupEvidence,
  listFeedbackSignals,
  loadFeedback,
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

  const repos = await findEnrichedRepos(pool, 500)
  if (repos.length === 0) throw new Error('还没有已富化的仓库，先运行采集与富化')

  const [feedback, signals, subscriptions, starred] = await Promise.all([
    loadFeedback(pool, userId),
    listFeedbackSignals(pool, userId),
    loadSubscriptions(pool, userId),
    loadUserStars(pool, userId),
  ])

  const context = buildFeedbackContext(feedback, signals)
  const ranked = rankForUser(user.profile, repos, Date.now(), context, subscriptions)
  const candidates = diversifyRanking(ranked, { limit: 12 })
  const groups = groupEvidence(candidates, user.profile, 3, 3)

  const watched = subscriptions.filter((sub) => sub.kind === 'release').map((sub) => sub.value)
  const targets = [...new Set([...starred, ...watched, ...candidates.map((repo) => repo.fullName)])].slice(0, 20)
  const events = await loadReleaseEvents(pool, targets, 12)
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
    rising: risingRepos(repos, 3).map((repo) => ({ ...repoEvidence(repo), growth: repo.growth })),
  }

  const draft = await generateIssueDraft(evidence, llm)
  return {
    title: draft.title,
    summary: draft.summary,
    html: renderDraftHtml(draft, evidence),
    markdown: renderDraftMarkdown(draft, evidence),
  }
}
