import {
  addSubscription,
  buildTasteProfile,
  ensureUser,
  setFeedback,
  updateEnrichment,
  upsertRepo,
  upsertUserProject,
  type DbPool,
} from '@repo-radar/core'

interface DemoRepo {
  fullName: string
  description: string
  language: string
  topics: string[]
  stars: number
  qualityScore: number
  verdict: 'recommend' | 'watch'
  summary: string
  reason: string
}

/** 演示数据：真实存在的仓库 + 中文摘要，方便没有模型 Key 的实例也有内容。 */
const DEMO_REPOS: DemoRepo[] = [
  {
    fullName: 'colinhacks/zod',
    description: 'TypeScript-first schema validation with static type inference',
    language: 'TypeScript',
    topics: ['typescript', 'validation', 'schema'],
    stars: 36_000,
    qualityScore: 0.9,
    verdict: 'recommend',
    summary: '以 TypeScript 类型推导为核心的 schema 校验库，适合做 API 入参和配置校验。',
    reason: '类型安全、生态成熟，接入成本低。',
  },
  {
    fullName: 'drizzle-team/drizzle-orm',
    description: 'Headless TypeScript ORM with a drizzle of SQL',
    language: 'TypeScript',
    topics: ['orm', 'typescript', 'sql', 'postgres'],
    stars: 31_000,
    qualityScore: 0.86,
    verdict: 'recommend',
    summary: '偏 SQL 的 TypeScript ORM，查询可组合、迁移可读，适合已有的 Postgres 项目。',
    reason: '类型推导和 SQL 控制力平衡，适合渐进迁移。',
  },
  {
    fullName: 'modelcontextprotocol/servers',
    description: 'Reference servers for the Model Context Protocol',
    language: 'TypeScript',
    topics: ['mcp', 'ai', 'agents', 'llm'],
    stars: 52_000,
    qualityScore: 0.82,
    verdict: 'recommend',
    summary: 'MCP 官方参考实现集合，覆盖文件系统、Git、搜索等常见工具接入。',
    reason: '想给自己的应用加 MCP 工具时可以直接抄结构。',
  },
  {
    fullName: 'openai/openai-node',
    description: 'Official JavaScript/TypeScript library for the OpenAI API',
    language: 'TypeScript',
    topics: ['openai', 'sdk', 'llm'],
    stars: 12_000,
    qualityScore: 0.8,
    verdict: 'recommend',
    summary: 'OpenAI 官方 Node SDK，包含流式响应、工具调用和结构化输出。',
    reason: '需要兼容多模型时可以作为接口层参考。',
  },
  {
    fullName: 'shadcn-ui/ui',
    description: 'Beautifully designed components you can copy and paste into your apps',
    language: 'TypeScript',
    topics: ['react', 'components', 'tailwind', 'design-system'],
    stars: 84_000,
    qualityScore: 0.84,
    verdict: 'recommend',
    summary: '可复制到项目里的 React 组件集合，基于 Radix 和 Tailwind，不绑定运行时。',
    reason: '适合想要可控样式、又不想引入完整组件库的项目。',
  },
  {
    fullName: 'tailwindlabs/tailwindcss',
    description: 'A utility-first CSS framework for rapid UI development',
    language: 'TypeScript',
    topics: ['css', 'tailwind', 'design-system'],
    stars: 87_000,
    qualityScore: 0.85,
    verdict: 'recommend',
    summary: '工具类 CSS 框架，配合组件库能快速统一界面。',
    reason: '生态和文档成熟，团队协作成本低。',
  },
  {
    fullName: 'vercel/next.js',
    description: 'The React Framework for the Web',
    language: 'TypeScript',
    topics: ['react', 'nextjs', 'web', 'framework'],
    stars: 135_000,
    qualityScore: 0.88,
    verdict: 'recommend',
    summary: 'React 全栈框架，App Router 提供 Server Components、流式渲染和缓存控制。',
    reason: '本项目自身就在用，适合作为长线参考。',
  },
  {
    fullName: 'oven-sh/bun',
    description: 'Incredibly fast JavaScript runtime, bundler, test runner, and package manager',
    language: 'Zig',
    topics: ['runtime', 'javascript', 'bundler'],
    stars: 78_000,
    qualityScore: 0.78,
    verdict: 'watch',
    summary: '集运行时、包管理、测试和打包于一体的 JavaScript 工具链。',
    reason: '性能亮眼，但生产替换需要评估兼容性。',
  },
  {
    fullName: 'langchain-ai/langchainjs',
    description: 'Build context-aware reasoning applications',
    language: 'TypeScript',
    topics: ['llm', 'agents', 'rag', 'typescript'],
    stars: 16_000,
    qualityScore: 0.74,
    verdict: 'watch',
    summary: 'LLM 应用编排框架，覆盖 RAG、工具调用和 agent 流程。',
    reason: '抽象层较重，适合先对照自己的编排方案。',
  },
  {
    fullName: 'sindresorhus/execa',
    description: 'Process execution for humans',
    language: 'JavaScript',
    topics: ['cli', 'nodejs', 'process'],
    stars: 8_000,
    qualityScore: 0.76,
    verdict: 'watch',
    summary: 'Node 里更好用的子进程封装，跨平台处理信号和输出。',
    reason: '写 CLI 或调用构建工具时值得参考。',
  },
]

export interface DemoSeedResult {
  repos: number
  user: string
  projects: number
}

/**
 * 幂等演示数据：仓库、star 快照、demo 用户画像、收藏、订阅和两个「维护中」项目。
 * 只用于自托管 demo / 截图，不代表真实归属。
 */
export async function runDemoSeed(pool: DbPool): Promise<DemoSeedResult> {
  for (const repo of DEMO_REPOS) {
    const [owner, name] = repo.fullName.split('/')
    if (!owner || !name) continue
    const { id } = await upsertRepo(pool, {
      fullName: repo.fullName,
      owner,
      name,
      description: repo.description,
      htmlUrl: `https://github.com/${repo.fullName}`,
      homepage: null,
      language: repo.language,
      topics: repo.topics,
      stars: repo.stars,
      forks: Math.round(repo.stars * 0.06),
      openIssues: Math.round(repo.stars * 0.004),
      license: 'MIT',
      archived: false,
      isFork: false,
      pushedAt: new Date().toISOString(),
      createdAt: '2020-01-01T00:00:00Z',
    })
    await updateEnrichment(pool, id, {
      summary: repo.summary,
      problem: '',
      audience: '',
      verdict: repo.verdict,
      reason: repo.reason,
      qualityScore: repo.qualityScore,
      qualityDetail: { seeded: true },
      readmeHash: null,
      embedding: null,
    })
    await pool.query(
      `INSERT INTO star_snapshots (repo_id, captured_on, stars)
       VALUES ($1, CURRENT_DATE - INTERVAL '7 days', $2)
       ON CONFLICT (repo_id, captured_on) DO UPDATE SET stars = EXCLUDED.stars`,
      [id, Math.round(repo.stars * 0.92)],
    )
  }

  const userId = await ensureUser(pool, {
    login: 'demo-radar',
    displayName: 'Demo Radar',
    avatarUrl: null,
    githubId: 999001,
  })

  const profile = buildTasteProfile({
    starred: DEMO_REPOS.map((repo) => ({
      topics: repo.topics,
      language: repo.language,
      embedding: null,
      weight: 1,
      source: 'star' as const,
    })),
  })
  await pool.query(
    `UPDATE users SET profile = $2::jsonb, prefs = '{"radarMode":"balanced"}'::jsonb WHERE id = $1`,
    [userId, JSON.stringify(profile)],
  )

  await setFeedback(pool, userId, 'colinhacks/zod', 'save')
  await addSubscription(pool, userId, 'topic', 'llm')

  const projects = ['colinhacks/zod', 'shadcn-ui/ui']
  for (const repoFullName of projects) {
    await upsertUserProject(pool, userId, repoFullName, { source: 'owned', active: true })
  }

  return { repos: DEMO_REPOS.length, user: 'demo-radar', projects: projects.length }
}
