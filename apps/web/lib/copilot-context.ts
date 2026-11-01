import {
  filterIntegrationProjects,
  filterMaintainerReport,
  findLatestIntegrationReport,
  findLatestMaintainerReport,
  findUserById,
  listHistory,
  listUserProjects,
  listWatchIntents,
  listWatchMatches,
  loadHandledState,
  loadIntegrationLibrary,
  loadMaintainerLibrary,
  loadWatchLibrary,
  watchMatchHandled,
  type CopilotContext,
  type DbPool,
} from '@repo-radar/core'

/**
 * 给搭档准备紧凑上下文：项目、最新周报、接入建议、关注代理和最近生成记录。
 */
export async function loadCopilotContext(
  pool: DbPool,
  userId: number,
  login: string,
): Promise<CopilotContext> {
  const [user, projects, maintainer, integration, intents, history, handled, integrationLibrary, watchLibrary, maintainerLibrary] =
    await Promise.all([
      findUserById(pool, userId),
      listUserProjects(pool, userId),
      findLatestMaintainerReport(pool, userId),
      findLatestIntegrationReport(pool, userId),
      listWatchIntents(pool, userId),
      listHistory(pool, userId, 12),
      loadHandledState(pool, userId),
      loadIntegrationLibrary(pool, userId),
      loadWatchLibrary(pool, userId),
      loadMaintainerLibrary(pool, userId),
    ])
  const filteredMaintainer = maintainer
    ? { ...maintainer, report: filterMaintainerReport(maintainer.report, handled) }
    : null
  const filteredIntegration = integration
    ? { ...integration, report: { ...integration.report, projects: filterIntegrationProjects(integration.report.projects, handled) } }
    : null

  const watch = await Promise.all(
    intents
      .filter((intent) => intent.active)
      .slice(0, 5)
      .map(async (intent) => ({
        intent: intent.text,
        matches: (await listWatchMatches(pool, intent.id, 5))
          .filter((match) => !watchMatchHandled(intent.id, match.repo, handled))
          .map((match) => ({
            repo: match.repo,
            score: match.score,
            reason: match.reason,
          })),
      })),
  )

  return {
    login,
    profile: user?.profile
      ? {
          topics: Object.entries(user.profile.topicWeights)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6)
            .map(([topic, weight]) => ({ topic, weight })),
          languages: Object.entries(user.profile.languageWeights)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4)
            .map(([language, weight]) => ({ language, weight })),
          starredCount: user.profile.starredCount,
        }
      : null,
    projects: projects
      .filter((project) => project.active)
      .slice(0, 8)
      .map((project) => ({
        repo: project.repoFullName,
        description: project.description ?? '',
        language: project.language,
        topics: project.topics.slice(0, 8),
      })),
    maintainer: filteredMaintainer
      ? {
          projects: filteredMaintainer.report.projects.map((project) => ({
            repo: project.repo,
            healthScore: project.healthScore,
            summary: project.summary,
            risks: project.risks.slice(0, 4),
            actions: project.actions.slice(0, 4),
            dependencies: project.dependencies.slice(0, 4).map((dependency) => ({
              name: dependency.name,
              current: dependency.current,
              latest: dependency.latest,
              risk: dependency.risk,
            })),
            items: project.items.slice(0, 6).map((item) => ({
              kind: item.kind,
              number: item.number,
              title: item.title,
              priority: item.priority,
              reason: item.reason,
            })),
          })),
        }
      : null,
    integration: filteredIntegration
      ? {
          projects: filteredIntegration.report.projects.map((project) => ({
            repo: project.repo,
            summary: project.summary,
            gaps: project.gaps.slice(0, 4),
            suggestions: project.suggestions.slice(0, 4).map((suggestion) => ({
              repo: suggestion.repo,
              kind: suggestion.kind,
              reason: suggestion.reason,
            })),
          })),
        }
      : null,
    watch,
    library: {
      integration: {
        totals: {
          items: integrationLibrary.totals.items,
          pending: integrationLibrary.totals.pending,
          adopted: integrationLibrary.totals.adopted,
          rejected: integrationLibrary.totals.rejected,
        },
        pendingItems: integrationLibrary.items
          .filter((item) => item.pending > 0)
          .slice(0, 10)
          .map((item) => ({
            repo: item.repo,
            total: item.total,
            projects: item.projects,
            latestReason: item.latestReason,
          })),
      },
      watch: {
        totals: {
          items: watchLibrary.totals.items,
          pending: watchLibrary.totals.pending,
          adopted: watchLibrary.totals.adopted,
          rejected: watchLibrary.totals.rejected,
        },
        pendingItems: watchLibrary.items
          .filter((item) => item.pending > 0)
          .slice(0, 10)
          .map((item) => ({
            repo: item.repo,
            total: item.total,
            intents: item.intents,
            latestReason: item.latestReason,
          })),
      },
      maintainer: {
        totals: {
          items: maintainerLibrary.totals.items,
          pending: maintainerLibrary.totals.pending,
          adopted: maintainerLibrary.totals.adopted,
          rejected: maintainerLibrary.totals.rejected,
        },
        pendingItems: maintainerLibrary.items
          .filter((item) => item.pending > 0)
          .slice(0, 10)
          .map((item) => ({
            label: item.label,
            project: item.project,
            kind: item.kind,
            total: item.total,
            latestDetail: item.latestDetail,
          })),
      },
    },
    history: history.map((entry) => ({
      kind: entry.kind,
      title: entry.title,
      createdAt: entry.createdAt,
    })),
  }
}
