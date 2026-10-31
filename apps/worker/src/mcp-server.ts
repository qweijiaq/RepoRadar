import { fileURLToPath } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  addSubscription,
  buildFeedbackContext,
  createPool,
  diversifyRanking,
  findEnrichedRepos,
  findLatestVerification,
  findRepoByFullName,
  findUserByLogin,
  isValidSubscriptionValue,
  listFeedbackSignals,
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
    const repos = await findEnrichedRepos(pool, 500)
    const feedback = user ? await loadFeedback(pool, user.id) : new Map()
    const signals = user ? await listFeedbackSignals(pool, user.id) : []
    const subscriptions = user ? await loadSubscriptions(pool, user.id) : []
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
