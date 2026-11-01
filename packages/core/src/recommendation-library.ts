import type { DbPool } from './db.js'
import { listFeedDismissals } from './feed-dismissals.js'
import { loadHandledState, type HandledState } from './handled.js'
import { listFeedStatuses } from './feed-statuses.js'
import type { StoredComparisonReport } from './comparison.js'
import type { StoredDiscoverabilityReport } from './discoverability.js'
import type { StoredIntegrationReport } from './integrations.js'
import type { StoredMaintainerReport } from './maintainer.js'
import { listIntegrationOutcomes, type IntegrationOutcome } from './integration-outcomes.js'

export type LibraryStatus = 'adopted' | 'rejected' | 'pending'

export interface IntegrationLibraryOccurrence {
  reportId: number
  generatedAt: string
  project: string
  kind: 'missing' | 'optimize'
  action: 'try' | 'watch'
  reason: string
  steps: string[]
  alreadyUsed: boolean
  status: LibraryStatus
}

export interface IntegrationLibraryItem {
  repo: string
  total: number
  reports: number
  projects: string[]
  adopted: number
  rejected: number
  pending: number
  firstSeenAt: string
  lastSeenAt: string
  latestReason: string
  latestKind: 'missing' | 'optimize'
  latestAction: 'try' | 'watch'
  latestProject: string
  occurrences: IntegrationLibraryOccurrence[]
}

export interface IntegrationLibraryTotals {
  items: number
  occurrences: number
  reports: number
  adopted: number
  rejected: number
  pending: number
}

export interface IntegrationLibrary {
  items: IntegrationLibraryItem[]
  totals: IntegrationLibraryTotals
}

export interface IntegrationReportRecord {
  id: number
  createdAt: string
  payload: StoredIntegrationReport
}

export interface WatchLibraryMatch {
  intentId: number
  intent: string
  repo: string
  score: number
  reason: string
  at: string
}

export interface WatchLibraryOccurrence {
  intentId: number
  intent: string
  score: number
  reason: string
  at: string
  status: LibraryStatus
}

export interface WatchLibraryItem {
  repo: string
  total: number
  intents: string[]
  adopted: number
  rejected: number
  pending: number
  firstSeenAt: string
  lastSeenAt: string
  latestReason: string
  bestScore: number
  occurrences: WatchLibraryOccurrence[]
}

export interface WatchLibraryTotals {
  items: number
  matches: number
  intents: number
  adopted: number
  rejected: number
  pending: number
}

export interface WatchLibrary {
  items: WatchLibraryItem[]
  totals: WatchLibraryTotals
}

function statusOf(
  outcomeMap: Map<string, 'adopted' | 'rejected'>,
  dismissed: Set<string>,
  done: Set<string>,
  project: string,
  repo: string,
): LibraryStatus {
  const outcome = outcomeMap.get(`${project}|${repo}`.toLowerCase())
  if (outcome) return outcome
  const feedKey = `integration:${project}:${repo}`.toLowerCase()
  if (dismissed.has(feedKey)) return 'rejected'
  if (done.has(feedKey)) return 'adopted'
  return 'pending'
}

function lowerSet(values: Iterable<string>): Set<string> {
  return new Set([...values].map((value) => value.toLowerCase()))
}

function time(value: string): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * 把历史接入报告按候选仓库聚合，并合并页面状态、Feed 忽略与完成状态。
 */
export function aggregateIntegrationLibrary(
  reports: IntegrationReportRecord[],
  outcomes: IntegrationOutcome[],
  dismissedKeys: Iterable<string>,
  doneKeys: Iterable<string>,
): IntegrationLibrary {
  const outcomeMap = new Map<string, 'adopted' | 'rejected'>(
    outcomes.map((outcome) => [
      `${outcome.projectFullName}|${outcome.suggestionRepo}`.toLowerCase(),
      outcome.status,
    ]),
  )
  const dismissed = lowerSet(dismissedKeys)
  const done = lowerSet(doneKeys)
  const items = new Map<string, IntegrationLibraryItem>()
  const reportIds = new Set<number>()
  const totals: IntegrationLibraryTotals = {
    items: 0,
    occurrences: 0,
    reports: 0,
    adopted: 0,
    rejected: 0,
    pending: 0,
  }

  const sorted = [...reports].sort((left, right) => time(right.createdAt) - time(left.createdAt))
  for (const record of sorted) {
    reportIds.add(record.id)
    for (const project of record.payload?.report?.projects ?? []) {
      for (const suggestion of project.suggestions ?? []) {
        const repo = suggestion.repo.trim()
        if (!repo) continue
        const key = repo.toLowerCase()
        const status = statusOf(outcomeMap, dismissed, done, project.repo, repo)
        const item =
          items.get(key) ??
          ({
            repo,
            total: 0,
            reports: 0,
            projects: [],
            adopted: 0,
            rejected: 0,
            pending: 0,
            firstSeenAt: record.createdAt,
            lastSeenAt: record.createdAt,
            latestReason: suggestion.reason,
            latestKind: suggestion.kind,
            latestAction: suggestion.action,
            latestProject: project.repo,
            occurrences: [],
          } satisfies IntegrationLibraryItem)

        item.total += 1
        item[status] += 1
        totals.occurrences += 1
        totals[status] += 1
        if (!item.projects.includes(project.repo)) item.projects.push(project.repo)
        if (time(record.createdAt) >= time(item.lastSeenAt)) {
          item.lastSeenAt = record.createdAt
          item.latestReason = suggestion.reason
          item.latestKind = suggestion.kind
          item.latestAction = suggestion.action
          item.latestProject = project.repo
        }
        if (time(record.createdAt) <= time(item.firstSeenAt)) item.firstSeenAt = record.createdAt
        item.occurrences.push({
          reportId: record.id,
          generatedAt: record.createdAt,
          project: project.repo,
          kind: suggestion.kind,
          action: suggestion.action,
          reason: suggestion.reason,
          steps: suggestion.steps ?? [],
          alreadyUsed: suggestion.alreadyUsed ?? false,
          status,
        })
        items.set(key, item)
      }
    }
  }

  const list = [...items.values()]
  for (const item of list) {
    item.reports = new Set(item.occurrences.map((occurrence) => occurrence.reportId)).size
    item.occurrences.sort((left, right) => time(right.generatedAt) - time(left.generatedAt))
  }
  list.sort((left, right) => time(right.lastSeenAt) - time(left.lastSeenAt) || right.total - left.total)
  totals.items = list.length
  totals.reports = reportIds.size
  return { items: list, totals }
}

/**
 * 把关注代理在不同意图下命中的同一仓库聚合起来，并合并已接入/不感兴趣状态。
 */
export function aggregateWatchLibrary(
  matches: WatchLibraryMatch[],
  dismissedKeys: Iterable<string>,
  doneKeys: Iterable<string>,
): WatchLibrary {
  const dismissed = lowerSet(dismissedKeys)
  const done = lowerSet(doneKeys)
  const items = new Map<string, WatchLibraryItem>()
  const intents = new Set<string>()
  const totals: WatchLibraryTotals = {
    items: 0,
    matches: 0,
    intents: 0,
    adopted: 0,
    rejected: 0,
    pending: 0,
  }

  const sorted = [...matches].sort((left, right) => time(right.at) - time(left.at))
  for (const match of sorted) {
    const repo = match.repo.trim()
    if (!repo) continue
    const key = repo.toLowerCase()
    const feedKey = `watch:${match.intentId}:${repo}`
    const status: LibraryStatus = dismissed.has(feedKey.toLowerCase())
      ? 'rejected'
      : done.has(feedKey.toLowerCase())
        ? 'adopted'
        : 'pending'
    const item =
      items.get(key) ??
      ({
        repo,
        total: 0,
        intents: [],
        adopted: 0,
        rejected: 0,
        pending: 0,
        firstSeenAt: match.at,
        lastSeenAt: match.at,
        latestReason: match.reason,
        bestScore: match.score,
        occurrences: [],
      } satisfies WatchLibraryItem)

    item.total += 1
    item[status] += 1
    totals.matches += 1
    totals[status] += 1
    if (!item.intents.includes(match.intent)) item.intents.push(match.intent)
    if (time(match.at) >= time(item.lastSeenAt)) {
      item.lastSeenAt = match.at
      item.latestReason = match.reason
    }
    if (time(match.at) <= time(item.firstSeenAt)) item.firstSeenAt = match.at
    item.bestScore = Math.max(item.bestScore, match.score)
    item.occurrences.push({
      intentId: match.intentId,
      intent: match.intent,
      score: match.score,
      reason: match.reason,
      at: match.at,
      status,
    })
    items.set(key, item)
  }

  const list = [...items.values()]
  for (const item of list) {
    for (const occurrence of item.occurrences) intents.add(occurrence.intent)
    item.occurrences.sort((left, right) => time(right.at) - time(left.at))
  }
  list.sort((left, right) => time(right.lastSeenAt) - time(left.lastSeenAt) || right.total - left.total)
  totals.items = list.length
  totals.intents = intents.size
  return { items: list, totals }
}

export interface MaintainerReportRecord {
  id: number
  createdAt: string
  payload: StoredMaintainerReport
}

export interface MaintainerLibraryOccurrence {
  reportId: number
  generatedAt: string
  project: string
  kind: 'item' | 'dependency'
  label: string
  detail: string
  status: LibraryStatus
  href: string
}

export interface MaintainerLibraryItem {
  key: string
  label: string
  project: string
  kind: 'item' | 'dependency'
  total: number
  reports: number
  adopted: number
  rejected: number
  pending: number
  firstSeenAt: string
  lastSeenAt: string
  latestDetail: string
  occurrences: MaintainerLibraryOccurrence[]
}

export interface MaintainerLibraryTotals {
  items: number
  occurrences: number
  reports: number
  projects: number
  adopted: number
  rejected: number
  pending: number
}

export interface MaintainerLibrary {
  items: MaintainerLibraryItem[]
  totals: MaintainerLibraryTotals
}

/** 把历史维护周报里的 Issue/PR 待办和依赖升级按项目聚合。 */
export function aggregateMaintainerLibrary(
  reports: MaintainerReportRecord[],
  dismissedKeys: Iterable<string>,
  doneKeys: Iterable<string>,
): MaintainerLibrary {
  const dismissed = lowerSet(dismissedKeys)
  const done = lowerSet(doneKeys)
  const items = new Map<string, MaintainerLibraryItem>()
  const reportIds = new Set<number>()
  const projects = new Set<string>()
  const totals: MaintainerLibraryTotals = {
    items: 0,
    occurrences: 0,
    reports: 0,
    projects: 0,
    adopted: 0,
    rejected: 0,
    pending: 0,
  }

  const statusOf = (feedKey: string): LibraryStatus => {
    const key = feedKey.toLowerCase()
    if (dismissed.has(key)) return 'rejected'
    if (done.has(key)) return 'adopted'
    return 'pending'
  }

  const sorted = [...reports].sort((left, right) => time(right.createdAt) - time(left.createdAt))
  for (const record of sorted) {
    reportIds.add(record.id)
    for (const project of record.payload?.report?.projects ?? []) {
      projects.add(project.repo)
      for (const item of project.items ?? []) {
        const label = `${project.repo} · ${item.kind === 'pull' ? 'PR' : 'Issue'} #${item.number}`
        const key = `${project.repo}|${item.kind}|${item.number}`
        const status = statusOf(`maintainer:${project.repo}:${item.kind}:${item.number}`)
        const entry =
          items.get(key) ??
          ({
            key,
            label,
            project: project.repo,
            kind: 'item',
            total: 0,
            reports: 0,
            adopted: 0,
            rejected: 0,
            pending: 0,
            firstSeenAt: record.createdAt,
            lastSeenAt: record.createdAt,
            latestDetail: `${item.title}：${item.reason}`,
            occurrences: [],
          } satisfies MaintainerLibraryItem)
        entry.total += 1
        entry[status] += 1
        totals.occurrences += 1
        totals[status] += 1
        if (time(record.createdAt) >= time(entry.lastSeenAt)) {
          entry.lastSeenAt = record.createdAt
          entry.latestDetail = `${item.title}：${item.reason}`
        }
        if (time(record.createdAt) <= time(entry.firstSeenAt)) entry.firstSeenAt = record.createdAt
        entry.occurrences.push({
          reportId: record.id,
          generatedAt: record.createdAt,
          project: project.repo,
          kind: 'item',
          label,
          detail: `${item.title}：${item.reason}`,
          status,
          href: `/maintain?report=${record.id}`,
        })
        items.set(key, entry)
      }

      for (const dependency of project.dependencies ?? []) {
        const label = `${project.repo} · ${dependency.name}`
        const key = `${project.repo}|dependency|${dependency.name}`
        const status = statusOf(
          `dependency:${project.repo}:${dependency.name}:${dependency.latest ?? 'unknown'}`,
        )
        const entry =
          items.get(key) ??
          ({
            key,
            label,
            project: project.repo,
            kind: 'dependency',
            total: 0,
            reports: 0,
            adopted: 0,
            rejected: 0,
            pending: 0,
            firstSeenAt: record.createdAt,
            lastSeenAt: record.createdAt,
            latestDetail: dependency.reason,
            occurrences: [],
          } satisfies MaintainerLibraryItem)
        entry.total += 1
        entry[status] += 1
        totals.occurrences += 1
        totals[status] += 1
        if (time(record.createdAt) >= time(entry.lastSeenAt)) {
          entry.lastSeenAt = record.createdAt
          entry.latestDetail = dependency.reason
        }
        if (time(record.createdAt) <= time(entry.firstSeenAt)) entry.firstSeenAt = record.createdAt
        entry.occurrences.push({
          reportId: record.id,
          generatedAt: record.createdAt,
          project: project.repo,
          kind: 'dependency',
          label,
          detail: dependency.reason,
          status,
          href: `/maintain?report=${record.id}`,
        })
        items.set(key, entry)
      }
    }
  }

  const list = [...items.values()]
  for (const entry of list) {
    entry.reports = new Set(entry.occurrences.map((occurrence) => occurrence.reportId)).size
    entry.occurrences.sort((left, right) => time(right.generatedAt) - time(left.generatedAt))
  }
  list.sort((left, right) => time(right.lastSeenAt) - time(left.lastSeenAt) || right.total - left.total)
  totals.items = list.length
  totals.reports = reportIds.size
  totals.projects = projects.size
  return { items: list, totals }
}

export interface ComparisonReportRecord {
  id: number
  createdAt: string
  payload: StoredComparisonReport
}

export interface ComparisonLibraryOccurrence {
  reportId: number
  generatedAt: string
  project: string
  fitScore: number
  recommended: boolean
  reason: string
  status: LibraryStatus
  href: string
}

export interface ComparisonLibraryItem {
  repo: string
  total: number
  reports: number
  projects: string[]
  recommended: number
  adopted: number
  rejected: number
  pending: number
  bestFitScore: number
  latestFitScore: number
  firstSeenAt: string
  lastSeenAt: string
  latestReason: string
  occurrences: ComparisonLibraryOccurrence[]
}

export interface ComparisonLibraryTotals {
  items: number
  occurrences: number
  reports: number
  projects: number
  recommended: number
  adopted: number
  rejected: number
  pending: number
}

export interface ComparisonLibrary {
  items: ComparisonLibraryItem[]
  totals: ComparisonLibraryTotals
}

/** 把历史选型对比按候选聚合，并合并接入处理状态。 */
export function aggregateComparisonLibrary(
  reports: ComparisonReportRecord[],
  handled: HandledState,
): ComparisonLibrary {
  const items = new Map<string, ComparisonLibraryItem>()
  const reportIds = new Set<number>()
  const projects = new Set<string>()
  const totals: ComparisonLibraryTotals = {
    items: 0,
    occurrences: 0,
    reports: 0,
    projects: 0,
    recommended: 0,
    adopted: 0,
    rejected: 0,
    pending: 0,
  }
  const statusOf = (project: string, repo: string): LibraryStatus => {
    const pair = `${project}|${repo}`.toLowerCase()
    const outcome = handled.outcomes.get(pair)
    if (outcome) return outcome
    const key = `integration:${project}:${repo}`.toLowerCase()
    if (handled.dismissed.has(key)) return 'rejected'
    if (handled.done.has(key)) return 'adopted'
    return 'pending'
  }

  const sorted = [...reports].sort((left, right) => time(right.createdAt) - time(left.createdAt))
  for (const record of sorted) {
    reportIds.add(record.id)
    const project = record.payload?.report?.project
    if (!project) continue
    projects.add(project)
    const recommendedRepo = record.payload.report.recommendation?.repo?.toLowerCase() ?? null
    for (const candidate of record.payload.report.candidates ?? []) {
      const repo = candidate.repo.trim()
      if (!repo) continue
      const key = repo.toLowerCase()
      const status = statusOf(project, repo)
      const recommended = recommendedRepo === key
      const entry =
        items.get(key) ??
        ({
          repo,
          total: 0,
          reports: 0,
          projects: [],
          recommended: 0,
          adopted: 0,
          rejected: 0,
          pending: 0,
          bestFitScore: candidate.fitScore,
          latestFitScore: candidate.fitScore,
          firstSeenAt: record.createdAt,
          lastSeenAt: record.createdAt,
          latestReason: candidate.reason,
          occurrences: [],
        } satisfies ComparisonLibraryItem)
      entry.total += 1
      entry[status] += 1
      if (recommended) {
        entry.recommended += 1
        totals.recommended += 1
      }
      totals.occurrences += 1
      totals[status] += 1
      if (!entry.projects.includes(project)) entry.projects.push(project)
      if (time(record.createdAt) >= time(entry.lastSeenAt)) {
        entry.lastSeenAt = record.createdAt
        entry.latestReason = candidate.reason
        entry.latestFitScore = candidate.fitScore
      }
      if (time(record.createdAt) <= time(entry.firstSeenAt)) entry.firstSeenAt = record.createdAt
      entry.bestFitScore = Math.max(entry.bestFitScore, candidate.fitScore)
      entry.occurrences.push({
        reportId: record.id,
        generatedAt: record.createdAt,
        project,
        fitScore: candidate.fitScore,
        recommended,
        reason: candidate.reason,
        status,
        href: `/compare?project=${encodeURIComponent(project)}&report=${record.id}`,
      })
      items.set(key, entry)
    }
  }

  const list = [...items.values()]
  for (const entry of list) {
    entry.reports = new Set(entry.occurrences.map((occurrence) => occurrence.reportId)).size
    entry.occurrences.sort((left, right) => time(right.generatedAt) - time(left.generatedAt))
  }
  list.sort((left, right) => time(right.lastSeenAt) - time(left.lastSeenAt) || right.total - left.total)
  totals.items = list.length
  totals.reports = reportIds.size
  totals.projects = projects.size
  return { items: list, totals }
}

export interface DiscoverabilityReportRecord {
  id: number
  repo: string
  createdAt: string
  payload: StoredDiscoverabilityReport
}

export interface DiscoverabilityLibraryOccurrence {
  reportId: number
  generatedAt: string
  score: number
  appliedAt: string | null
  href: string
}

export interface DiscoverabilityLibraryItem {
  repo: string
  total: number
  applied: number
  pending: number
  latestScore: number
  bestScore: number
  firstSeenAt: string
  lastSeenAt: string
  occurrences: DiscoverabilityLibraryOccurrence[]
}

export interface DiscoverabilityLibraryTotals {
  items: number
  reports: number
  applied: number
  pending: number
}

export interface DiscoverabilityLibrary {
  items: DiscoverabilityLibraryItem[]
  totals: DiscoverabilityLibraryTotals
}

/** 把历史曝光优化按仓库聚合，并统计已应用/未应用次数。 */
export function aggregateDiscoverabilityLibrary(
  reports: DiscoverabilityReportRecord[],
): DiscoverabilityLibrary {
  const items = new Map<string, DiscoverabilityLibraryItem>()
  const totals: DiscoverabilityLibraryTotals = { items: 0, reports: 0, applied: 0, pending: 0 }
  const sorted = [...reports].sort((left, right) => time(right.createdAt) - time(left.createdAt))
  for (const record of sorted) {
    const repo = record.repo.trim()
    if (!repo) continue
    const key = repo.toLowerCase()
    const score = Number(record.payload?.report?.score ?? 0)
    const appliedAt = record.payload?.appliedAt ?? null
    const entry =
      items.get(key) ??
      ({
        repo,
        total: 0,
        applied: 0,
        pending: 0,
        latestScore: score,
        bestScore: score,
        firstSeenAt: record.createdAt,
        lastSeenAt: record.createdAt,
        occurrences: [],
      } satisfies DiscoverabilityLibraryItem)
    entry.total += 1
    if (appliedAt) {
      entry.applied += 1
      totals.applied += 1
    } else {
      entry.pending += 1
      totals.pending += 1
    }
    totals.reports += 1
    if (time(record.createdAt) >= time(entry.lastSeenAt)) {
      entry.lastSeenAt = record.createdAt
      entry.latestScore = score
    }
    if (time(record.createdAt) <= time(entry.firstSeenAt)) entry.firstSeenAt = record.createdAt
    entry.bestScore = Math.max(entry.bestScore, score)
    entry.occurrences.push({
      reportId: record.id,
      generatedAt: record.payload?.generatedAt ?? record.createdAt,
      score,
      appliedAt,
      href: `/repos/${repo}/optimize?report=${record.id}`,
    })
    items.set(key, entry)
  }
  const list = [...items.values()]
  for (const entry of list) {
    entry.occurrences.sort((left, right) => time(right.generatedAt) - time(left.generatedAt))
  }
  list.sort((left, right) => time(right.lastSeenAt) - time(left.lastSeenAt) || right.total - left.total)
  totals.items = list.length
  return { items: list, totals }
}

export async function loadIntegrationLibrary(
  pool: DbPool,
  userId: number,
  options: { limitReports?: number } = {},
): Promise<IntegrationLibrary> {
  const limit = Math.max(1, Math.min(500, options.limitReports ?? 200))
  const [reports, outcomes, dismissals, statuses] = await Promise.all([
    pool.query<{ id: string; created_at: Date | string; payload: StoredIntegrationReport }>(
      `SELECT id, created_at, payload FROM integration_reports
       WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [userId, limit],
    ),
    listIntegrationOutcomes(pool, userId),
    listFeedDismissals(pool, userId),
    listFeedStatuses(pool, userId),
  ])
  return aggregateIntegrationLibrary(
    reports.rows.map((row) => ({
      id: Number(row.id),
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      payload: row.payload,
    })),
    outcomes,
    dismissals
      .filter((entry) => entry.kind === 'integration' || entry.key.startsWith('integration:'))
      .map((entry) => entry.key),
    statuses
      .filter((entry) => entry.kind === 'integration' || entry.key.startsWith('integration:'))
      .map((entry) => entry.key),
  )
}

export async function loadWatchLibrary(pool: DbPool, userId: number): Promise<WatchLibrary> {
  const [matches, dismissals, statuses] = await Promise.all([
    pool.query<{
      intent_id: string
      intent: string
      repo_full_name: string
      score: number
      reason: string
      created_at: Date | string
    }>(
      `SELECT m.intent_id, i.text AS intent, m.repo_full_name, m.score, m.reason, m.created_at
       FROM watch_matches m
       JOIN watch_intents i ON i.id = m.intent_id
       WHERE i.user_id = $1
       ORDER BY m.created_at DESC
       LIMIT 2000`,
      [userId],
    ),
    listFeedDismissals(pool, userId),
    listFeedStatuses(pool, userId),
  ])
  return aggregateWatchLibrary(
    matches.rows.map((row) => ({
      intentId: Number(row.intent_id),
      intent: row.intent,
      repo: row.repo_full_name,
      score: Number(row.score),
      reason: row.reason,
      at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    })),
    dismissals
      .filter((entry) => entry.kind === 'watch' || entry.key.startsWith('watch:'))
      .map((entry) => entry.key),
    statuses
      .filter((entry) => entry.kind === 'watch' || entry.key.startsWith('watch:'))
      .map((entry) => entry.key),
  )
}


export async function loadMaintainerLibrary(
  pool: DbPool,
  userId: number,
  options: { limitReports?: number } = {},
): Promise<MaintainerLibrary> {
  const limit = Math.max(1, Math.min(500, options.limitReports ?? 200))
  const [reports, dismissals, statuses] = await Promise.all([
    pool.query<{ id: string; created_at: Date | string; payload: StoredMaintainerReport }>(
      `SELECT id, created_at, payload FROM maintainer_reports
       WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [userId, limit],
    ),
    listFeedDismissals(pool, userId),
    listFeedStatuses(pool, userId),
  ])
  return aggregateMaintainerLibrary(
    reports.rows.map((row) => ({
      id: Number(row.id),
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      payload: row.payload,
    })),
    dismissals
      .filter((entry) => entry.kind === 'maintainer' || entry.kind === 'dependency')
      .map((entry) => entry.key),
    statuses
      .filter((entry) => entry.kind === 'maintainer' || entry.kind === 'dependency')
      .map((entry) => entry.key),
  )
}


export async function loadComparisonLibrary(
  pool: DbPool,
  userId: number,
  options: { limitReports?: number } = {},
): Promise<ComparisonLibrary> {
  const limit = Math.max(1, Math.min(500, options.limitReports ?? 200))
  const [reports, handled] = await Promise.all([
    pool.query<{ id: string; created_at: Date | string; payload: StoredComparisonReport }>(
      `SELECT id, created_at, payload FROM comparison_reports
       WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [userId, limit],
    ),
    loadHandledState(pool, userId),
  ])
  return aggregateComparisonLibrary(
    reports.rows.map((row) => ({
      id: Number(row.id),
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      payload: row.payload,
    })),
    handled,
  )
}


export async function loadDiscoverabilityLibrary(
  pool: DbPool,
  userId: number,
  options: { limitReports?: number } = {},
): Promise<DiscoverabilityLibrary> {
  const limit = Math.max(1, Math.min(500, options.limitReports ?? 200))
  const { rows } = await pool.query<{
    id: string
    repo_full_name: string
    created_at: Date | string
    payload: StoredDiscoverabilityReport
  }>(
    `SELECT id, repo_full_name, created_at, payload FROM discoverability_reports
     WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, limit],
  )
  return aggregateDiscoverabilityLibrary(
    rows.map((row) => ({
      id: Number(row.id),
      repo: row.repo_full_name,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      payload: row.payload,
    })),
  )
}
