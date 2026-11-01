import type { DbPool } from './db.js'
import { listFeedDismissals } from './feed-dismissals.js'
import { listFeedStatuses } from './feed-statuses.js'
import { listIntegrationOutcomes } from './integration-outcomes.js'
import type { IntegrationProject } from './integrations.js'
import type { MaintainerReport } from './maintainer.js'

export interface HandledState {
  /** 已忽略的 Feed 条目 key（小写） */
  dismissed: Set<string>
  /** 已完成的 Feed 条目 key（小写） */
  done: Set<string>
  /** 显式设置的接入结果，key 为 project|repo（小写） */
  outcomes: Map<string, 'adopted' | 'rejected'>
}

export async function loadHandledState(pool: DbPool, userId: number): Promise<HandledState> {
  const [outcomes, dismissals, statuses] = await Promise.all([
    listIntegrationOutcomes(pool, userId),
    listFeedDismissals(pool, userId),
    listFeedStatuses(pool, userId),
  ])
  return {
    dismissed: new Set(dismissals.map((entry) => entry.key.toLowerCase())),
    done: new Set(statuses.map((entry) => entry.key.toLowerCase())),
    outcomes: new Map(
      outcomes.map((outcome) => [
        `${outcome.projectFullName}|${outcome.suggestionRepo}`.toLowerCase(),
        outcome.status,
      ]),
    ),
  }
}

function isHandled(state: HandledState, key: string): boolean {
  const normalized = key.toLowerCase()
  return state.dismissed.has(normalized) || state.done.has(normalized)
}

/** 从已处理的 Feed key 中提取被推荐的仓库名，用于全局推荐去重。 */
export function handledRepoNames(state: HandledState): Set<string> {
  const names = new Set<string>()
  for (const key of [...state.dismissed, ...state.done]) {
    if (key.startsWith('gem:')) {
      names.add(key.slice('gem:'.length))
    } else if (key.startsWith('watch:') || key.startsWith('integration:')) {
      const parts = key.split(':')
      if (parts.length >= 3) names.add(parts.slice(2).join(':'))
    }
  }
  return names
}

export function watchMatchHandled(intentId: number, repo: string, state: HandledState): boolean {
  return isHandled(state, `watch:${intentId}:${repo}`)
}

export function filterIntegrationProjects(
  projects: IntegrationProject[],
  state: HandledState,
): IntegrationProject[] {
  return projects
    .map((project) => ({
      ...project,
      suggestions: project.suggestions.filter((suggestion) => {
        const pair = `${project.repo}|${suggestion.repo}`.toLowerCase()
        if (state.outcomes.has(pair)) return false
        return !isHandled(state, `integration:${project.repo}:${suggestion.repo}`)
      }),
    }))
    .filter((project) => project.suggestions.length > 0)
}

/** 去掉已完成/已忽略的维护待办和依赖升级，保留项目摘要和风险。 */
export function filterMaintainerReport(
  report: MaintainerReport,
  state: HandledState,
): MaintainerReport {
  return {
    ...report,
    projects: report.projects.map((project) => ({
      ...project,
      items: project.items.filter(
        (item) =>
          !isHandled(state, `maintainer:${project.repo}:${item.kind}:${item.number}`),
      ),
      dependencies: project.dependencies.filter(
        (dependency) =>
          !isHandled(
            state,
            `dependency:${project.repo}:${dependency.name}:${dependency.latest ?? 'unknown'}`,
          ),
      ),
    })),
  }
}
