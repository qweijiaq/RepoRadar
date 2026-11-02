import { fileURLToPath } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  addSubscription,
  assertAiQuota,
  assertJobQuota,
  buildFeedbackContext,
  createPool,
  diversifyRanking,
  findEnrichedRepos,
  filterIntegrationProjects,
  filterMaintainerReport,
  findLatestComparisonReport,
  findLatestIntegrationReport,
  findLatestMaintainerReport,
  findLatestVerification,
  computeTrendStats,
  createJob,
  encryptJobToken,
  getJob,
  loadRepoProfile,
  loadStoredLlmConfig,
  loadTrendReport,
  loadUserGithubToken,
  findRepoByFullName,
  findUserByLogin,
  handledRepoNames,
  isValidSubscriptionValue,
  listFeedbackSignals,
  listPatchDrafts,
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
  searchByIntent,
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

  server.registerTool(
    'pick_library',
    {
      title: '按任务选库',
      description:
        '给一个任务描述，返回最匹配的开源库候选（含质量分、摘要和是否已验证），用于写代码前选依赖',
      inputSchema: {
        task: z.string().describe('要完成的任务，例如「给 Next.js 应用加结构化日志」'),
        language: z.string().optional().describe('限定语言，例如 TypeScript'),
        limit: z.number().int().min(1).max(10).optional(),
      },
    },
    async ({ task, language, limit }) => {
      const keywords = [
        ...new Set(
          task
            .split(/[^A-Za-z0-9\u4e00-\u9fff]+/)
            .map((word) => word.trim())
            .filter((word) => word.length >= 2),
        ),
      ].slice(0, 3)
      const queries = keywords.length > 0 ? keywords : [task.slice(0, 40)]
      const batches = await Promise.all(
        queries.map((query) => searchEnrichedRepos(pool, { query, language, limit: 10 })),
      )
      const seen = new Map<string, EnrichedRepoRecord>()
      for (const repo of batches.flat()) {
        if (!seen.has(repo.fullName)) seen.set(repo.fullName, repo)
      }
      const candidates = [...seen.values()]
        .sort((left, right) => (right.qualityScore ?? 0) - (left.qualityScore ?? 0))
        .slice(0, limit ?? 5)
        .map((repo) => toItem(repo))
      return textResult({ task, keywords, candidates })
    },
  )

  server.registerTool(
    'integration_preflight',
    {
      title: '查看接入预演结果',
      description:
        '返回某个项目对某个候选库最近一次「试接入」的补丁、构建状态和改动文件；没有记录时给出提示',
      inputSchema: {
        project: z.string().describe('你的项目，owner/name'),
        candidate: z.string().describe('候选库，owner/name'),
        login: z.string().optional(),
      },
    },
    async ({ project, candidate, login }) => {
      const user = await resolveUser(login)
      if (!user) return errorResult('需要提供 login，或设置 RADAR_MCP_USER 环境变量')
      const drafts = await listPatchDrafts(pool, user.id, { repo: project, limit: 20 })
      const trial = drafts.find(
        (draft) => draft.kind === 'integration' && draft.title.includes(candidate),
      )
      if (!trial) {
        return textResult({
          found: false,
          hint: '还没有试接入记录：在 /workbench/integrations 对这条建议点击「试接入（沙箱预演）」',
        })
      }
      return textResult({
        found: true,
        status: trial.status,
        summary: trial.summary,
        files: trial.files,
        applies: trial.validation?.applies ?? null,
        buildStatus: trial.validation?.buildStatus ?? null,
        patch: trial.patch.slice(0, 4000),
      })
    },
  )

  server.registerTool(
    'similar_diff',
    {
      title: '相似项目能力差异',
      description: '返回某个项目最近一次选型对比的能力矩阵和候选差异，可按候选过滤',
      inputSchema: {
        project: z.string().describe('你的项目，owner/name'),
        candidate: z.string().optional().describe('只看某个候选，owner/name'),
        login: z.string().optional(),
      },
    },
    async ({ project, candidate, login }) => {
      const user = await resolveUser(login)
      if (!user) return errorResult('需要提供 login，或设置 RADAR_MCP_USER 环境变量')
      const stored = await findLatestComparisonReport(pool, user.id, project)
      if (!stored) {
        return textResult({
          found: false,
          hint: '还没有对比报告：在 /compare 生成一次选型对比',
        })
      }
      const report = stored.report
      const candidates = candidate
        ? report.candidates.filter((item) => item.repo.toLowerCase() === candidate.toLowerCase())
        : report.candidates
      return textResult({
        found: true,
        project: report.project,
        recommendation: report.recommendation,
        capabilities: report.capabilities,
        candidates,
      })
    },
  )

  type QueueResult = { ok: true; jobId: number } | { ok: false; error: string }

  async function queueJob(
    login: string | undefined,
    kind: 'integration-trial' | 'comparison' | 'swap-trial',
    title: string,
    payload: Record<string, unknown>,
  ): Promise<QueueResult> {
    const user = await resolveUser(login)
    if (!user) return { ok: false, error: '需要提供 login，或设置 RADAR_MCP_USER 环境变量' }
    const token = await loadUserGithubToken(pool, user.id)
    if (!token) return { ok: false, error: '这个用户没有保存 GitHub token，请先在 Web 登录授权' }
    try {
      await assertJobQuota(pool, user.id, kind)
      await assertAiQuota(pool, user.id)
      const jobId = await createJob(pool, {
        userId: user.id,
        kind,
        title,
        payload: { ...payload, token: encryptJobToken(token) },
      })
      return { ok: true, jobId }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  server.registerTool(
    'generate_integration_preflight',
    {
      title: '触发接入预演',
      description:
        '为项目和候选库排队一次沙箱试接入，返回 jobId。需要 worker 在运行；用 get_job_status 轮询结果。',
      inputSchema: {
        project: z.string().describe('你的项目，owner/name'),
        candidate: z.string().describe('候选库，owner/name'),
        file: z.string().optional().describe('可选：接入文件路径，例如 src/lib/foo.ts'),
        login: z.string().optional(),
      },
    },
    async ({ project, candidate, file, login }) => {
      const result = await queueJob(
        login,
        'integration-trial',
        `接入预演 · ${project} ← ${candidate}`,
        { project, repo: candidate, ...(file ? { file } : {}), origin: '/workbench/integrations' },
      )
      if (!result.ok) return errorResult(result.error)
      return textResult({
        jobId: result.jobId,
        status: 'queued',
        hint: 'worker 处理完后，用 get_job_status 查看 result.href',
      })
    },
  )

  server.registerTool(
    'generate_comparison',
    {
      title: '触发选型对比',
      description:
        '为一个项目和 2-5 个候选库排队一次对比，返回 jobId。需要 worker 在运行；用 get_job_status 轮询结果。',
      inputSchema: {
        project: z.string().describe('你的项目，owner/name'),
        candidates: z.array(z.string()).min(2).max(5).describe('候选库 owner/name 列表'),
        login: z.string().optional(),
      },
    },
    async ({ project, candidates, login }) => {
      const result = await queueJob(login, 'comparison', `选型对比 · ${project}`, {
        project,
        candidates,
        origin: '/compare',
      })
      if (!result.ok) return errorResult(result.error)
      return textResult({
        jobId: result.jobId,
        status: 'queued',
        hint: 'worker 处理完后，用 get_job_status 查看 result.href',
      })
    },
  )

  server.registerTool(
    'generate_swap_trial',
    {
      title: '触发换库预演',
      description:
        '把项目里的一个包换成另一个包，排队一次沙箱迁移验证。mode=mechanical 时用 Babel 机械替换、不调用模型。',
      inputSchema: {
        project: z.string().describe('你的项目，owner/name'),
        from: z.string().describe('旧包名，例如 axios'),
        to: z.string().describe('新包名，例如 ofetch'),
        file: z.string().optional().describe('可选：要重写 import 的文件'),
        mode: z.enum(['llm', 'mechanical']).optional(),
        login: z.string().optional(),
      },
    },
    async ({ project, from, to, file, mode, login }) => {
      const result = await queueJob(login, 'swap-trial', `换库预演 · ${project} ${from} → ${to}`, {
        project,
        fromPackage: from,
        toPackage: to,
        ...(file ? { file } : {}),
        ...(mode ? { mode } : {}),
        origin: '/workbench/swap',
      })
      if (!result.ok) return errorResult(result.error)
      return textResult({
        jobId: result.jobId,
        status: 'queued',
        hint: 'worker 处理完后，用 get_job_status 查看 result.href',
      })
    },
  )

  server.registerTool(
    'get_trends',
    {
      title: '本周趋势',
      description: '返回最近一次趋势简报（AI 摘要 + 增长最快仓库 + topic 动量）；没有简报时返回数据版',
      inputSchema: {},
    },
    async () => {
      const report = await loadTrendReport(pool)
      if (report) return textResult(report)
      const stats = await computeTrendStats(pool)
      return textResult({ stats, hint: 'AI 简报尚未生成，worker 会自动补上' })
    },
  )

  server.registerTool(
    'find_repos',
    {
      title: '意图搜索仓库',
      description: '用自然语言描述需求，返回理解后的关键词/过滤条件和带解释的候选仓库',
      inputSchema: {
        query: z.string().describe('需求描述，例如「能解析 PDF 表格的 TypeScript 库」'),
        limit: z.number().int().min(1).max(10).optional(),
      },
    },
    async ({ query, limit }) => {
      const llm = loadConfig().llm ?? (await loadStoredLlmConfig(pool))
      if (!llm) return errorResult('还没有配置 AI 模型')
      const result = await searchByIntent(pool, llm, query, { limit: limit ?? 5 })
      return textResult({
        intent: result.intent,
        answer: result.answer,
        results: result.results.map((hit) => ({
          ...toItem(hit.repo),
          fit: hit.fit,
          why: hit.why,
          gaps: hit.gaps,
        })),
      })
    },
  )

  server.registerTool(
    'explain_repo',
    {
      title: '解释仓库功能',
      description: '返回仓库的 AI 功能画像：定位、能力点、适用场景和上手步骤；没有画像时给出生成提示',
      inputSchema: {
        repo: z.string().describe('仓库全名，owner/name'),
      },
    },
    async ({ repo }) => {
      const profile = await loadRepoProfile(pool, repo)
      if (!profile) {
        return textResult({
          found: false,
          hint: '还没有功能画像：在仓库页点击「生成功能画像」，或在 Web 的 /r/<owner>/<name> 生成',
        })
      }
      return textResult({ found: true, ...profile })
    },
  )

  server.registerTool(
    'get_job_status',
    {
      title: '查询任务状态',
      description: '按 jobId 查询排队/运行/完成状态，完成后返回结果链接',
      inputSchema: {
        jobId: z.number().int().positive(),
        login: z.string().optional(),
      },
    },
    async ({ jobId, login }) => {
      const user = await resolveUser(login)
      if (!user) return errorResult('需要提供 login，或设置 RADAR_MCP_USER 环境变量')
      const job = await getJob(pool, user.id, jobId)
      if (!job) return errorResult('没有找到这个任务')
      return textResult({
        id: job.id,
        kind: job.kind,
        status: job.status,
        progress: job.progress,
        error: job.error,
        result: job.result,
      })
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
