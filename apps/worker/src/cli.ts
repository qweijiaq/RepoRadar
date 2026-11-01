#!/usr/bin/env node
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import {
  buildFeedbackContext,
  buildSearchQueries,
  createPool,
  diversifyRanking,
  enrichRepo,
  escapeMarkdownCell,
  fetchLatestRelease,
  fetchReadme,
  findEnrichedRepos,
  findPendingRepos,
  findReposForVerification,
  findUserByLogin,
  finishIngestRun,
  generateIssueDraft,
  groupEvidence,
  hashReadme,
  listFeedbackSignals,
  listReleaseWatchRepos,
  listUsersWithProfiles,
  loadConfig,
  loadFeedback,
  loadStoredLlmConfig,
  loadSubscriptions,
  loadUserStars,
  migrate,
  notifyReleaseSubscribers,
  rankForUser,
  rankRepos,
  resolveBaseUrl,
  resolveMailConfig,
  resolveNotificationEmail,
  appendUnsubscribeFooter,
  renderDigestHtml,
  renderDigestMarkdown,
  renderDraftHtml,
  renderDraftMarkdown,
  renderIssueMarkdown,
  repoEvidence,
  risingRepos,
  runDoctor,
  runVerification,
  saveReleaseEvent,
  saveSnapshot,
  saveVerification,
  searchRepos,
  sleep,
  syncRepoActivity,
  startIngestRun,
  summarizeProfile,
  updateEnrichment,
  upsertRepo,
  type AppConfig,
  type DbPool,
  type EnrichedRepoRecord,
  type IssueEvidence,
  type IssueReleaseEvidence,
  type SearchWindow,
  type UserRecord,
} from '@repo-radar/core'

function loadEnvFiles(): void {
  try {
    process.loadEnvFile()
  } catch {
    // 根目录 .env 可选
  }
  try {
    // Web 端的 AUTH_SECRET 用于解密页面里保存的模型 API Key
    process.loadEnvFile(join(process.cwd(), 'apps/web/.env.local'))
  } catch {
    // 可选
  }
}

loadEnvFiles()

if (process.env.NODE_ENV === 'production' && !process.env.AUTH_SECRET?.trim()) {
  console.error('生产环境缺少 AUTH_SECRET，拒绝启动。')
  process.exit(1)
}

const HELP = `RepoRadar CLI（M2）

用法：pnpm radar <command> [options]

命令：
  migrate              应用数据库 schema
  ingest               从 GitHub 采集候选仓库
  enrich               LLM / 启发式富化待处理仓库
  list                 输出排序后的推荐列表
  digest               生成个性化摘要（可写入文件或发邮件）
  issue                生成周报选题证据包（release 变化 + 主题聚类）
  verify               在 Docker 沙箱中克隆并构建候选仓库
  rising               按近 7 天 star 相对增速输出「正在起飞」项目
  releases             检查 release 订阅仓库的最新版本
  activity             轮询维护中仓库的 star/fork/Issue/PR/release 动态
  mcp                  以 MCP server（stdio）方式运行，供 agent 调用
  pipeline             依次执行 ingest → enrich → list
  doctor               检查数据库、迁移、模型、GitHub 授权、邮件和任务队列

选项：
  --topics=a,b         采集的 GitHub topics（默认来自 RADAR_TOPICS）；enrich 时用作过滤
  --days=30            只采集最近 N 天有推送的仓库
  --pages=1            每条查询抓取页数（每页默认 50 条）
  --per-page=50        每页数量
  --delay-ms=2200      GitHub 请求间隔（Search API 限制 30 次/分钟）
  --language=ts        按语言筛选
  --limit=20           enrich 默认 100；list 默认 20；digest 默认 10；verify 默认 3；issue 默认 12
  --format=md|json|html  list：md/json；digest：md/html；issue：md/json，--draft 后支持 html
  --dry-run            只打印采集查询（或 verify 的目标列表），不执行

issue 专用：
  --user=<login>       必填，指定要生成证据包的用户
  --days=7             版本窗口，只把窗口内的 release 标为「新」
  --release-limit=20   最多检查多少个仓库的 release
  --draft              调用 LLM 生成完整周报草稿（需要 LLM_API_KEY）

activity 专用：
  --user=<login>       必填；使用环境变量 GITHUB_TOKEN 轮询该用户的活跃项目
  --max-projects=15    最多检查多少个维护中项目

verify 专用：
  --min-quality=0.6    最低质量分（默认 0.6）
  --repo=owner/name    只验证指定仓库
  --from-path=<dir>    用本地目录代替 clone（需配合 --repo，调试用）
  --timeout-ms=600000  单个仓库的执行超时
  --keep               保留临时克隆目录

digest 专用：
  --user=<login>       指定用户
  --all                为所有有画像的用户生成
  --to=<email>         收件人（默认使用用户邮箱）
  --out=<path>         写入文件而不是打印
  --send               通过 SMTP 发送（设置页配置，或 SMTP_URL）

示例：
  pnpm radar migrate
  pnpm radar ingest --topics=llm,ai-agents --days=30
  pnpm radar enrich --limit=50
  pnpm radar list --limit=20
  pnpm radar digest --user=demo --limit=10
  pnpm radar digest --all --send
  pnpm radar verify --limit=3
  pnpm radar rising --limit=10
  pnpm radar releases
  pnpm radar issue --user=demo
  pnpm radar issue --user=demo --draft --format=html --out=issue.html
  pnpm radar mcp`

const SEARCH_WINDOWS: SearchWindow[] = [
  { min: 50, max: 500 },
  { min: 500, max: 5000 },
  { min: 5000, max: null },
]

function intArg(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function floatArg(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function listArg(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  return items.length > 0 ? items : fallback
}

async function runMigrate(pool: DbPool): Promise<void> {
  await migrate(pool)
  console.log('数据库 schema 已应用')
}

interface IngestOptions {
  topics: string[]
  days: number
  pages: number
  perPage: number
  delayMs: number
  language?: string
  dryRun: boolean
}

async function runIngest(
  pool: DbPool,
  config: AppConfig,
  options: IngestOptions,
): Promise<{ seen: number; inserted: number }> {
  const queries = buildSearchQueries({
    topics: options.topics,
    days: options.days,
    windows: SEARCH_WINDOWS,
    language: options.language,
  })
  console.log(`共 ${queries.length} 条搜索查询，每条最多 ${options.pages} 页`)

  if (options.dryRun) {
    for (const query of queries) console.log(`  ${query}`)
    return { seen: 0, inserted: 0 }
  }

  const token = config.githubToken
  if (!token) console.warn('未配置 GITHUB_TOKEN，使用匿名请求（Search API 限 10 次/分钟；富化时将跳过 README）')

  const runId = await startIngestRun(pool)
  let seen = 0
  let inserted = 0
  let queryCount = 0

  try {
    for (const query of queries) {
      queryCount++
      for (let page = 1; page <= options.pages; page++) {
        const repos = await searchRepos(query, {
          token: token ?? undefined,
          page,
          perPage: options.perPage,
        })
        console.log(`  [${queryCount}/${queries.length}] ${query} 第 ${page} 页：${repos.length} 个`)
        for (const repo of repos) {
          if (repo.isFork || repo.archived) continue
          seen++
          const result = await upsertRepo(pool, repo)
          if (result.inserted) inserted++
          await saveSnapshot(pool, result.id, repo.stars)
        }
        if (repos.length < options.perPage) break
        await sleep(options.delayMs)
      }
      await sleep(options.delayMs)
    }
  } catch (error) {
    await finishIngestRun(pool, runId, { queryCount, reposSeen: seen, reposNew: inserted }, String(error))
    throw error
  }

  await finishIngestRun(pool, runId, { queryCount, reposSeen: seen, reposNew: inserted })
  console.log(`采集完成：处理 ${seen} 条，新增 ${inserted} 个仓库`)
  return { seen, inserted }
}

async function runEnrich(pool: DbPool, config: AppConfig, limit: number, topics?: string[]): Promise<number> {
  const repos = await findPendingRepos(pool, limit, { topics })
  if (repos.length === 0) {
    console.log('没有待富化的仓库')
    return 0
  }
  console.log(`待富化 ${repos.length} 个仓库${config.llm ? '' : '（未配置 LLM_API_KEY，使用启发式规则）'}`)

  let done = 0
  for (const repo of repos) {
    const readme = config.githubToken
      ? await fetchReadme(repo.fullName, config.githubToken).catch(() => null)
      : null
    const result = await enrichRepo(repo, { llm: config.llm, readme })
    await updateEnrichment(pool, repo.id, {
      ...result,
      readmeHash: hashReadme(readme),
    })
    done++
    console.log(`  ✓ ${repo.fullName} → ${result.verdict} (${result.qualityScore}) ${result.summary}`)
    await sleep(150)
  }
  return done
}

type RankedRepo = EnrichedRepoRecord & { score: number }

function formatMarkdownTable(rows: RankedRepo[]): string {
  const header = [
    '| # | 项目 | ★ | 语言 | 分数 | 摘要 | 理由 |',
    '| --- | --- | ---: | --- | ---: | --- | --- |',
  ]
  const lines = rows.map((repo, index) => {
    const summary = escapeMarkdownCell(repo.summary ?? '')
    const reason = escapeMarkdownCell(repo.reason ?? '')
    return `| ${index + 1} | [${repo.fullName}](${repo.htmlUrl}) | ${repo.stars} | ${repo.language ?? '-'} | ${repo.score.toFixed(3)} | ${summary} | ${reason} |`
  })
  return [...header, ...lines].join('\n')
}

async function runList(pool: DbPool, limit: number, format: 'md' | 'json'): Promise<void> {
  const enriched = await findEnrichedRepos(pool, 500)
  const ranked = rankRepos(enriched).filter((repo) => repo.verdict !== 'skip')
  const top = ranked.slice(0, limit)

  if (format === 'json') {
    console.log(
      JSON.stringify(
        top.map((repo, index) => ({
          rank: index + 1,
          fullName: repo.fullName,
          url: repo.htmlUrl,
          stars: repo.stars,
          language: repo.language,
          score: repo.score,
          verdict: repo.verdict,
          summary: repo.summary,
          reason: repo.reason,
        })),
        null,
        2,
      ),
    )
    return
  }

  console.log(`\nRepoRadar — ${new Date().toISOString().slice(0, 10)}\n`)
  console.log(`已富化 ${enriched.length} 个仓库，展示前 ${top.length} 个\n`)
  console.log(formatMarkdownTable(top))
}

interface DigestCliOptions {
  user?: string
  all: boolean
  to?: string
  out?: string
  send: boolean
  limit: number
  format: 'md' | 'html'
}

async function sendDigestEmail(
  pool: DbPool,
  input: { to: string; subject: string; text: string; html: string },
): Promise<void> {
  const mail = await resolveMailConfig(pool)
  if (!mail) throw new Error('还没有配置邮件通道，请先在设置页填写 SMTP 或配置 SMTP_URL')
  const nodemailer = await import('nodemailer')
  const transport = mail.url
    ? nodemailer.createTransport(mail.url)
    : nodemailer.createTransport({
        host: mail.host,
        port: mail.port,
        secure: mail.secure,
        ...(mail.user && mail.pass ? { auth: { user: mail.user, pass: mail.pass } } : {}),
      })
  await transport.sendMail({
    from: mail.from,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
  })
}

async function runDigest(pool: DbPool, options: DigestCliOptions): Promise<void> {
  let users: UserRecord[] = []
  if (options.all) {
    users = await listUsersWithProfiles(pool)
  } else if (options.user) {
    const user = await findUserByLogin(pool, options.user)
    if (!user) throw new Error(`找不到用户：${options.user}`)
    users = [user]
  } else {
    throw new Error('请用 --user=<login> 指定用户，或用 --all 生成所有用户的摘要')
  }
  if (users.length === 0) throw new Error('没有可生成摘要的用户（需要先登录并生成口味画像）')
  if (options.out && users.length > 1) throw new Error('--out 仅支持单个用户')

  const repos = await findEnrichedRepos(pool, 500)
  const baseUrl = await resolveBaseUrl(pool)
  const date = new Date()
  const outputs: string[] = []

  for (const user of users) {
    const feedback = await loadFeedback(pool, user.id)
    const signals = await listFeedbackSignals(pool, user.id)
    const subscriptions = await loadSubscriptions(pool, user.id)
    const context = buildFeedbackContext(feedback, signals)
    const ranked = rankForUser(user.profile, repos, date.getTime(), context, subscriptions)
    const items = diversifyRanking(ranked, { limit: options.limit })
    const digestOptions = { items, userName: user.login, date, baseUrl }
    const text = renderDigestMarkdown(digestOptions)
    const html = renderDigestHtml(digestOptions)

    if (options.send) {
      const to = options.to?.trim() || resolveNotificationEmail(user)
      if (!to) throw new Error(`${user.login} 没有邮箱，请用 --to 指定收件人`)
      const content = appendUnsubscribeFooter(html, text, user.id, baseUrl)
      await sendDigestEmail(pool, {
        to,
        subject: `RepoRadar 精选 — ${date.toISOString().slice(0, 10)}`,
        text: content.text,
        html: content.html,
      })
      console.log(`已发送摘要到 ${to}`)
    }

    if (options.out) {
      await writeFile(options.out, options.format === 'html' ? html : text, 'utf8')
      console.log(`已写入 ${options.out}`)
    } else if (!options.send) {
      outputs.push(options.format === 'html' ? html : text)
    }
  }

  if (outputs.length > 0) console.log(outputs.join('\n\n---\n\n'))
}

interface VerifyCliOptions {
  limit: number
  minQuality: number
  repo?: string
  fromPath?: string
  dryRun: boolean
  keep: boolean
  timeoutMs: number
  logDir: string
}

const VERIFY_LABELS: Record<string, string> = {
  verified: '✅ 已验证',
  failed: '❌ 构建失败',
  skipped: '⏭ 已跳过',
  error: '⚠️ 验证出错',
}

async function runVerify(pool: DbPool, options: VerifyCliOptions): Promise<void> {
  if (options.fromPath && !options.repo) {
    throw new Error('使用 --from-path 时必须同时提供 --repo=owner/name')
  }

  const targets = options.repo
    ? [{ fullName: options.repo, qualityScore: null }]
    : await findReposForVerification(pool, { limit: options.limit, minQuality: options.minQuality })

  if (targets.length === 0) {
    console.log('没有需要验证的仓库（可能都已验证过，或质量分不够）')
    return
  }

  console.log(`待验证 ${targets.length} 个仓库：`)
  for (const target of targets) {
    console.log(`  - ${target.fullName}${target.qualityScore === null ? '' : `（质量 ${target.qualityScore}）`}`)
  }
  if (options.dryRun) return

  for (const target of targets) {
    console.log(`\n▶ 验证 ${target.fullName}`)
    const result = await runVerification({
      repoFullName: target.fullName,
      fromPath: options.fromPath,
      timeoutMs: options.timeoutMs,
      logDir: options.logDir,
      keepWorkDir: options.keep,
    })
    await saveVerification(pool, result)
    console.log(
      `  ${VERIFY_LABELS[result.status] ?? result.status} · ${result.stack} · ${Math.round(result.durationMs / 1000)}s`,
    )
    if (result.commands.length > 0) console.log(`  命令：${result.commands.join(' && ')}`)
    if (result.error) console.log(`  错误：${result.error}`)
  }
}

interface IssueCliOptions {
  user: string
  days: number
  limit: number
  releaseLimit: number
  out?: string
  format: 'md' | 'json' | 'html'
  draft: boolean
}

async function runIssue(pool: DbPool, config: AppConfig, options: IssueCliOptions): Promise<void> {
  if (options.format === 'html' && !options.draft) throw new Error('--format=html 需要同时使用 --draft')
  if (options.draft && !config.llm) {
    throw new Error('未配置 LLM_API_KEY，无法生成叙事草稿；去掉 --draft 可以只输出证据包')
  }

  const user = await findUserByLogin(pool, options.user)
  if (!user) throw new Error(`找不到用户：${options.user}`)

  const repos = await findEnrichedRepos(pool, 500)
  const [feedback, signals, subscriptions, starred] = await Promise.all([
    loadFeedback(pool, user.id),
    listFeedbackSignals(pool, user.id),
    loadSubscriptions(pool, user.id),
    loadUserStars(pool, user.id),
  ])

  const context = buildFeedbackContext(feedback, signals)
  const ranked = rankForUser(user.profile, repos, Date.now(), context, subscriptions)
  const candidates = diversifyRanking(ranked, { limit: options.limit })
  const groups = groupEvidence(candidates, user.profile, 3, 3)

  const watched = subscriptions.filter((sub) => sub.kind === 'release').map((sub) => sub.value)
  // 优先检查「本期候选 + 已富化的 star 项目」，再补充其余 star 和 release 订阅
  const enrichedNames = new Set(repos.map((repo) => repo.fullName))
  const starredEnriched = [...starred].filter((name) => enrichedNames.has(name))
  const candidateNames = candidates.map((repo) => repo.fullName)
  const targets = [...new Set([...starredEnriched, ...candidateNames, ...starred, ...watched])].slice(
    0,
    options.releaseLimit,
  )
  const releases: IssueReleaseEvidence[] = []

  for (const fullName of targets) {
    try {
      const release = await fetchLatestRelease(fullName, config.githubToken ?? undefined)
      if (!release) {
        releases.push({
          repoFullName: fullName,
          tag: null,
          name: null,
          url: null,
          publishedAt: null,
          isNew: false,
          isStarred: starred.has(fullName),
        })
      } else {
        await saveReleaseEvent(pool, { repoFullName: fullName, ...release })
        const published = release.publishedAt
        const isNew = published ? Date.now() - Date.parse(published) <= options.days * 86_400_000 : false
        releases.push({ repoFullName: fullName, ...release, isNew, isStarred: starred.has(fullName) })
      }
    } catch (error) {
      console.error(`[issue] ${fullName}: ${error instanceof Error ? error.message : String(error)}`)
    }
    await sleep(350)
  }

  releases.sort((a, b) => {
    if (a.isNew !== b.isNew) return a.isNew ? -1 : 1
    return (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '')
  })

  const evidence: IssueEvidence = {
    userName: user.login,
    date: new Date(),
    windowDays: options.days,
    totalCandidates: repos.length,
    profile: summarizeProfile(user.profile),
    releases,
    groups,
    rising: risingRepos(repos, 3).map((repo) => ({ ...repoEvidence(repo), growth: repo.growth })),
  }

  const output = await (async () => {
    if (options.draft) {
      if (!config.llm) {
        throw new Error('未配置 LLM_API_KEY，无法生成叙事草稿；去掉 --draft 可以只输出证据包')
      }
      const draft = await generateIssueDraft(evidence, config.llm)
      if (options.format === 'json') return JSON.stringify({ draft, evidence }, null, 2)
      if (options.format === 'html') return renderDraftHtml(draft, evidence)
      return renderDraftMarkdown(draft, evidence)
    }

    if (options.format === 'html') throw new Error('--format=html 需要同时使用 --draft')
    return options.format === 'json' ? JSON.stringify(evidence, null, 2) : renderIssueMarkdown(evidence)
  })()

  if (options.out) {
    await writeFile(options.out, output, 'utf8')
    console.log(`已写入 ${options.out}`)
  } else {
    console.log(output)
  }
}

async function runRising(pool: DbPool, limit: number): Promise<void> {  const repos = await findEnrichedRepos(pool, 500)
  const rising = risingRepos(repos, limit)
  if (rising.length === 0) {
    console.log('暂无可计算的 star 增速（需要至少 7 天前的快照）')
    return
  }

  console.log('| # | 项目 | ★ | 7 天增速 | 语言 |')
  console.log('| --- | --- | ---: | ---: | --- |')
  rising.forEach((repo, index) => {
    console.log(
      `| ${index + 1} | [${repo.fullName}](${repo.htmlUrl}) | ${repo.stars} | +${(repo.growth * 100).toFixed(1)}% | ${repo.language ?? '-'} |`,
    )
  })
}

async function runReleases(config: AppConfig, pool: DbPool): Promise<void> {
  const watched = await listReleaseWatchRepos(pool)
  if (watched.length === 0) {
    console.log('没有 release 订阅（可在设置页或通过 MCP 添加）')
    return
  }

  console.log(`检查 ${watched.length} 个关注仓库的最新 release`)
  for (const fullName of watched) {
    try {
      const release = await fetchLatestRelease(fullName, config.githubToken ?? undefined)
      if (!release) {
        console.log(`  · ${fullName}: 没有 release`)
      } else {
        const isNew = await saveReleaseEvent(pool, { repoFullName: fullName, ...release })
        if (isNew) {
          await notifyReleaseSubscribers(pool, { repoFullName: fullName, ...release })
        }
        console.log(`  ${isNew ? '🆕' : '·'} ${fullName} ${release.tag}${release.name ? ` — ${release.name}` : ''}`)
      }
    } catch (error) {
      console.log(`  ⚠️ ${fullName}: ${error instanceof Error ? error.message : String(error)}`)
    }
    await sleep(300)
  }
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      topics: { type: 'string' },
      days: { type: 'string' },
      pages: { type: 'string' },
      'per-page': { type: 'string' },
      'delay-ms': { type: 'string' },
      language: { type: 'string' },
      limit: { type: 'string' },
      format: { type: 'string' },
      'dry-run': { type: 'boolean' },
      user: { type: 'string' },
      all: { type: 'boolean' },
      to: { type: 'string' },
      out: { type: 'string' },
      send: { type: 'boolean' },
      'min-quality': { type: 'string' },
      repo: { type: 'string' },
      'from-path': { type: 'string' },
      'timeout-ms': { type: 'string' },
      'release-limit': { type: 'string' },
      'max-projects': { type: 'string' },
      draft: { type: 'boolean' },
      keep: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  })

  const command = positionals[0] ?? 'help'
  if (values.help || command === 'help') {
    console.log(HELP)
    return
  }

  const config = loadConfig()
  const ingestOptions: IngestOptions = {
    topics: listArg(values.topics, config.search.topics),
    days: intArg(values.days, config.search.days),
    pages: intArg(values.pages, 1),
    perPage: intArg(values['per-page'], 50),
    delayMs: intArg(values['delay-ms'], config.search.delayMs),
    language: values.language,
    dryRun: Boolean(values['dry-run']),
  }
  const enrichLimit = intArg(values.limit, 100)
  const enrichTopics = values.topics ? listArg(values.topics, []) : undefined
  const listLimit = intArg(values.limit, 20)
  const listFormat = values.format === 'json' ? 'json' : 'md'
  const digestFormat: 'md' | 'html' = values.format === 'html' ? 'html' : 'md'

  const pool = createPool(config.databaseUrl)
  const effectiveConfig: AppConfig =
    config.llm || command === 'migrate'
      ? config
      : { ...config, llm: await loadStoredLlmConfig(pool) }
  try {
    switch (command) {
      case 'migrate':
        await runMigrate(pool)
        break
      case 'ingest':
        await runIngest(pool, effectiveConfig, ingestOptions)
        break
      case 'enrich':
        await runEnrich(pool, effectiveConfig, enrichLimit, enrichTopics)
        break
      case 'list':
        await runList(pool, listLimit, listFormat)
        break
      case 'digest':
        await runDigest(pool, {
          user: values.user,
          all: Boolean(values.all),
          to: values.to,
          out: values.out,
          send: Boolean(values.send),
          limit: intArg(values.limit, 10),
          format: digestFormat,
        })
        break
      case 'verify':
        await runVerify(pool, {
          limit: intArg(values.limit, 3),
          minQuality: floatArg(values['min-quality'], 0.6),
          repo: values.repo,
          fromPath: values['from-path'],
          dryRun: Boolean(values['dry-run']),
          keep: Boolean(values.keep),
          timeoutMs: intArg(values['timeout-ms'], 600_000),
          logDir: join(process.cwd(), '.radar', 'verifications'),
        })
        break
      case 'rising':
        await runRising(pool, intArg(values.limit, 10))
        break
      case 'issue':
        if (!values.user) throw new Error('请用 --user=<login> 指定用户')
        await runIssue(pool, effectiveConfig, {
          user: values.user,
          days: intArg(values.days, 7),
          limit: intArg(values.limit, 12),
          releaseLimit: intArg(values['release-limit'], 20),
          out: values.out,
          format: values.format === 'html' ? 'html' : values.format === 'json' ? 'json' : 'md',
          draft: Boolean(values.draft),
        })
        break
      case 'releases':
        await runReleases(effectiveConfig, pool)
        break
      case 'activity': {
        if (!values.user) throw new Error('请用 --user=<login> 指定用户')
        if (!config.githubToken) throw new Error('轮询 GitHub 动态需要 GITHUB_TOKEN')
        const user = await findUserByLogin(pool, values.user)
        if (!user) throw new Error(`用户不存在：${values.user}`)
        const result = await syncRepoActivity(pool, user.id, user.login, config.githubToken, {
          maxProjects: intArg(values['max-projects'], 15),
        })
        console.log(
          `已检查 ${result.repos} 个仓库，新增 ${result.notifications} 条通知` +
            (result.warnings.length > 0 ? `，${result.warnings.length} 个仓库读取失败` : ''),
        )
        break
      }
      case 'mcp':
        await import('./mcp-server.js')
        break
      case 'pipeline':
        await runIngest(pool, effectiveConfig, ingestOptions)
        await runEnrich(pool, effectiveConfig, enrichLimit)
        await runList(pool, listLimit, listFormat)
        break
      case 'doctor': {
        const checks = await runDoctor(pool, { llm: effectiveConfig.llm })
        for (const item of checks) {
          const icon = item.level === 'ok' ? '✓' : item.level === 'warn' ? '!' : '✗'
          console.log(`${icon} ${item.title}：${item.detail}`)
        }
        if (checks.some((item) => item.level === 'error')) process.exitCode = 1
        break
      }
      default:
        console.error(`未知命令：${command}\n`)
        console.log(HELP)
        process.exitCode = 1
    }
  } finally {
    await pool.end()
  }
}

main().catch((error: unknown) => {
  console.error(`\n执行失败：${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
