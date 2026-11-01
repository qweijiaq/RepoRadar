import { fileURLToPath } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  addSubscription,
  buildFeedbackContext,
  createPool,
  diversifyRanking,
  findEnrichedRepos,
  filterIntegrationProjects,
  filterMaintainerReport,
  findLatestIntegrationReport,
  findLatestMaintainerReport,
  findLatestVerification,
  findRepoByFullName,
  findUserByLogin,
  handledRepoNames,
  isValidSubscriptionValue,
  listFeedbackSignals,
  listWatchIntents,
  listWatchMatches,
  loadComparisonLibrary,
  loadDiscoverabilityLibrary,
  loadHandledState,
  loadIntegrationLibrary,
  loadMaintainerLibrary,
  loadWatchLibrary,
  watchMatchHandled,
  loadConfig,
  loadFeedback,
  loadReleaseEvents,
  loadSubscriptions,
  rankForUser,
  renderDigestMarkdown,
  resolveBaseUrl,
  risingRepos,
  searchEnrichedRepos,
  setFeedback,
  type DbPool,
  type EnrichedRepoRecord,
  type SubscriptionKind,
  type UserRecord,
} from '@repo-radar/core'
import { z } from 'zod'

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)))
} catch {
  // .env 可选
}

type RepoSummary = EnrichedRepoRecord & { score?: number }

function toItem(repo: RepoSummary) {
  return {
    fullName: repo.fullName,
    url: repo.htmlUrl,
    stars: repo.stars,
    language: repo.language,
    topics: repo.topics,
    score: repo.score,
    summary: repo.summary,
    reason: repo.reason,
    verified: repo.verifyStatus === 'verified',
  }
}

function textResult(payload: unknown) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)
  return { content: [{ type: 'text' as const, text }] }
}

function errorResult(message: string) {
  return { isError: true, content: [{ type: 'text' as const, text: message }] }
}

function createServer(pool: DbPool): McpServer {
  const server = new McpServer({ name: 'repo-radar', version: '0.1.0' })

  async function resolveUser(login?: string): Promise<UserRecord | null> {
    const target = login?.trim() || process.env.RADAR_MCP_USER?.trim()
    if (!target) return null
    return findUserByLogin(pool, target)
  }

  async function buildRecommendations(login: string | undefined, limit: number) {
    const user = await resolveUser(login)
    const [allRepos, feedback, signals, subscriptions, handled] = await Promise.all([
      findEnrichedRepos(pool, 500),
      user ? loadFeedback(pool, user.id) : Promise.resolve(new Map()),
      user ? listFeedbackSignals(pool, user.id) : Promise.resolve([]),
      user ? loadSubscriptions(pool, user.id) : Promise.resolve([]),
      user ? loadHandledState(pool, user.id) : Promise.resolve(null),
    ])
    const hiddenNames = handled ? handledRepoNames(handled) : new Set<string>()
    const repos = allRepos.filter((repo) => !hiddenNames.has(repo.fullName.toLowerCase()))
    const context = buildFeedbackContext(feedback, signals)
    const ranked = rankForUser(user?.profile ?? null, repos, Date.now(), context, subscriptions)
    return diversifyRanking(ranked, { limit }).map((repo) => toItem(repo))
  }

  server.registerTool(
    'search_repos',
    {
      title: '搜索 RepoRadar 项目库',
      description: '按关键词、GitHub topic 或语言搜索已经富化的开源项目',
      inputSchema: {
        query: z.string().optional().describe('关键词，匹配仓库名、摘要或描述'),
        topic: z.string().optional().describe('GitHub topic，例如 llm'),
        language: z.string().optional().describe('编程语言，例如 TypeScript'),
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    async ({ query, topic, language, limit }) => {
      const repos = await searchEnrichedRepos(pool, { query, topic, language, limit: limit ?? 10 })
      return textResult(repos.map((repo) => toItem(repo)))
    },
  )

  server.registerTool(
    'get_recommendations',
    {
      title: '获取个性化推荐',
      description: '按用户的 star 画像、反馈和订阅规则排序，返回推荐项目',
      inputSchema: {
        login: z.string().optional().describe('RepoRadar 用户登录名，默认使用 RADAR_MCP_USER'),
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    async ({ login, limit }) => textResult(await buildRecommendations(login, limit ?? 10)),
  )

  server.registerTool(
    'get_digest',
    {
      title: '生成推荐摘要',
      description: '生成 Markdown 格式的个性化摘要，可直接用于周报或邮件内容',
      inputSchema: {
        login: z.string().optional(),
        limit: z.number().int().min(1).max(30).optional(),
      },
    },
    async ({ login, limit }) => {
      const user = await resolveUser(login)
      const items = await buildRecommendations(login, limit ?? 10)
      const baseUrl = await resolveBaseUrl(pool)
      return textResult(
        renderDigestMarkdown({
          items: items.map((item) => ({
            fullName: item.fullName,
            htmlUrl: item.url,
            stars: item.stars,
            language: item.language,
            summary: item.summary,
            reason: item.reason,
            score: item.score ?? 0,
          })),
          userName: user?.login ?? login ?? 'global',
          baseUrl,
        }),
      )
    },
  )

  server.registerTool(
    'get_recommendation_library',
    {
      title: '按库查看历史建议',
      description: '汇总接入、关注、维护、选型对比或曝光优化的历史建议，并返回处理和未处理数量',
      inputSchema: {
        login: z.string().optional(),
        kind: z.enum(['integration', 'watch', 'maintainer', 'comparison', 'discoverability']),
        status: z.enum(['pending', 'adopted', 'rejected']).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    async ({ login, kind, status, limit }) => {
      const user = await resolveUser(login)
      if (!user) return errorResult('需要提供 login，或设置 RADAR_MCP_USER 环境变量')
      const max = limit ?? 20
      if (kind === 'integration') {
        const library = await loadIntegrationLibrary(pool, user.id)
        const items = library.items
          .filter((item) => !status || item[status] > 0)
          .slice(0, max)
          .map((item) => ({
            repo: item.repo,
            total: item.total,
            reports: item.reports,
            projects: item.projects,
            adopted: item.adopted,
            rejected: item.rejected,
            pending: item.pending,
            lastSeenAt: item.lastSeenAt,
            latestReason: item.latestReason,
          }))
        return textResult({ kind, totals: library.totals, items })
      }
      if (kind === 'watch') {
        const library = await loadWatchLibrary(pool, user.id)
        const items = library.items
          .filter((item) => !status || item[status] > 0)
          .slice(0, max)
          .map((item) => ({
            repo: item.repo,
            total: item.total,
            intents: item.intents,
            adopted: item.adopted,
            rejected: item.rejected,
            pending: item.pending,
            lastSeenAt: item.lastSeenAt,
            latestReason: item.latestReason,
          }))
        return textResult({ kind, totals: library.totals, items })
      }
      if (kind === 'maintainer') {
        const library = await loadMaintainerLibrary(pool, user.id)
        const items = library.items
          .filter((item) => !status || item[status] > 0)
          .slice(0, max)
          .map((item) => ({
            label: item.label,
            project: item.project,
            type: item.kind,
            total: item.total,
            reports: item.reports,
            adopted: item.adopted,
            rejected: item.rejected,
            pending: item.pending,
            lastSeenAt: item.lastSeenAt,
            latestDetail: item.latestDetail,
          }))
        return textResult({ kind, totals: library.totals, items })
      }
      if (kind === 'comparison') {
        const library = await loadComparisonLibrary(pool, user.id)
        const items = library.items
          .filter((item) => !status || item[status] > 0)
          .slice(0, max)
          .map((item) => ({
            repo: item.repo,
            total: item.total,
            projects: item.projects,
            recommended: item.recommended,
            bestFitScore: item.bestFitScore,
            adopted: item.adopted,
            rejected: item.rejected,
            pending: item.pending,
            lastSeenAt: item.lastSeenAt,
          }))
        return textResult({ kind, totals: library.totals, items })
      }
      const library = await loadDiscoverabilityLibrary(pool, user.id)
      const items = library.items
        .filter((item) => !status || (status === 'pending' ? item.pending > 0 : status === 'adopted' ? item.applied > 0 : false))
        .slice(0, max)
        .map((item) => ({
          repo: item.repo,
          reports: item.total,
          latestScore: item.latestScore,
          bestScore: item.bestScore,
          applied: item.applied,
          pending: item.pending,
          lastSeenAt: item.lastSeenAt,
        }))
      return textResult({ kind, totals: library.totals, items })
    },
  )

  server.registerTool(
    'get_pending_work',
    {
      title: '查看未处理的建议和待办',
      description: '返回未处理的接入建议、维护 Issue/依赖和关注命中，自动排除已接入、忽略和已完成内容',
      inputSchema: {
        login: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    async ({ login, limit }) => {
      const user = await resolveUser(login)
      if (!user) return errorResult('需要提供 login，或设置 RADAR_MCP_USER 环境变量')
      const max = limit ?? 20
      const [handled, integration, maintainer, intents] = await Promise.all([
        loadHandledState(pool, user.id),
        findLatestIntegrationReport(pool, user.id),
        findLatestMaintainerReport(pool, user.id),
        listWatchIntents(pool, user.id),
      ])
      const integrationItems = integration
        ? filterIntegrationProjects(integration.report.projects, handled).flatMap((project) =>
            project.suggestions.map((suggestion) => ({
              project: project.repo,
              repo: suggestion.repo,
              kind: suggestion.kind,
              reason: suggestion.reason,
            })),
          )
        : []
      const maintainerProjects = maintainer
        ? filterMaintainerReport(maintainer.report, handled).projects
        : []
      const watch = await Promise.all(
        intents
          .filter((intent) => intent.active)
          .slice(0, 5)
          .map(async (intent) => ({
            intent: intent.text,
            matches: (await listWatchMatches(pool, intent.id, 10))
              .filter((match) => !watchMatchHandled(intent.id, match.repo, handled))
              .slice(0, 5)
              .map((match) => ({ repo: match.repo, score: match.score, reason: match.reason })),
          })),
      )
      return textResult({
        integration: integrationItems.slice(0, max),
        maintainer: maintainerProjects
          .filter((project) => project.items.length > 0 || project.dependencies.length > 0)
          .map((project) => ({
            repo: project.repo,
            items: project.items.map((item) => ({
              kind: item.kind,
              number: item.number,
              title: item.title,
              priority: item.priority,
            })),
            dependencies: project.dependencies.map((dependency) => ({
              name: dependency.name,
              current: dependency.current,
              latest: dependency.latest,
              risk: dependency.risk,
            })),
          }))
          .slice(0, max),
        watch,
        handledCounts: {
          dismissed: handled.dismissed.size,
          done: handled.done.size,
          outcomes: handled.outcomes.size,
        },
      })
    },
  )

  server.registerTool(
    'get_repo',
    {
      title: '查看项目详情',
      description: '返回单个仓库的摘要、评分和最近一次验证结果',
      inputSchema: {
        fullName: z.string().describe('owner/name'),
      },
    },
    async ({ fullName }) => {
      const repo = await findRepoByFullName(pool, fullName)
      if (!repo) return errorResult(`没有找到 ${fullName}`)
      const verification = await findLatestVerification(pool, fullName)
      return textResult({ ...toItem(repo), verification })
    },
  )

  server.registerTool(
    'record_feedback',
    {
      title: '记录反馈',
      description: '把收藏或“不感兴趣”写入用户反馈，后续推荐会随之调整',
      inputSchema: {
        repo: z.string().describe('owner/name'),
        kind: z.enum(['save', 'hide']),
        login: z.string().optional(),
      },
    },
    async ({ repo, kind, login }) => {
      const user = await resolveUser(login)
      if (!user) return errorResult('需要提供 login，或设置 RADAR_MCP_USER 环境变量')
      await setFeedback(pool, user.id, repo, kind)
      return textResult({ ok: true, repo, kind })
    },
  )

  server.registerTool(
    'add_subscription',
    {
      title: '添加订阅',
      description: '订阅 topic / language / author / release，影响推荐排序并追踪版本更新',
      inputSchema: {
        kind: z.enum(['topic', 'language', 'author', 'release']),
        value: z.string(),
        login: z.string().optional(),
      },
    },
    async ({ kind, value, login }) => {
      const user = await resolveUser(login)
      if (!user) return errorResult('需要提供 login，或设置 RADAR_MCP_USER 环境变量')
      if (!isValidSubscriptionValue(kind as SubscriptionKind, value)) return errorResult('订阅值格式不正确')
      await addSubscription(pool, user.id, kind as SubscriptionKind, value)
      return textResult({ ok: true, kind, value })
    },
  )

  server.registerTool(
    'list_rising',
    {
      title: '正在起飞的项目',
      description: '按近 7 天 star 相对增速排序，返回增长最快的项目',
      inputSchema: {
        limit: z.number().int().min(1).max(30).optional(),
      },
    },
    async ({ limit }) => {
      const repos = await findEnrichedRepos(pool, 500)
      const rising = risingRepos(repos, limit ?? 10)
      return textResult(
        rising.map((repo) => ({ ...toItem(repo), growth: repo.growth })),
      )
    },
  )

  server.registerTool(
    'list_release_updates',
    {
      title: '关注项目的版本更新',
      description: '返回已订阅仓库最近的 release 事件',
      inputSchema: {
        login: z.string().optional(),
        limit: z.number().int().min(1).max(20).optional(),
      },
    },
    async ({ login, limit }) => {
      const user = await resolveUser(login)
      if (!user) return errorResult('需要提供 login，或设置 RADAR_MCP_USER 环境变量')
      const subscriptions = await loadSubscriptions(pool, user.id)
      const watched = subscriptions.filter((sub) => sub.kind === 'release').map((sub) => sub.value)
      return textResult(await loadReleaseEvents(pool, watched, limit ?? 5))
    },
  )

  return server
}

export async function startMcpServer(): Promise<void> {
  const config = loadConfig()
  const pool = createPool(config.databaseUrl)
  const server = createServer(pool)
  const transport = new StdioServerTransport()
  await server.connect(transport)
  process.stderr.write('[repo-radar] MCP server 已启动（stdio）\n')
}

await startMcpServer()
