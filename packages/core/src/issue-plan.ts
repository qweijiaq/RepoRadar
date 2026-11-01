import { z } from 'zod'
import type { LlmConfig } from './config.js'
import type { DbPool } from './db.js'
import { extractJsonObjects } from './integrations.js'
import { chatCompletion } from './llm.js'

export interface IssueContext {
  repo: string
  number: number
  title: string
  body: string | null
  labels: string[]
  author: string | null
  comments: Array<{ author: string; body: string }>
  files: string[]
}

export interface IssueProjectContext {
  description: string
  language: string | null
  topics: string[]
  readme: string | null
  manifestName: string | null
  manifest: string | null
}

export const issuePlanSchema = z.object({
  summary: z.string().min(4).max(400),
  likelyFiles: z.array(z.string().min(2).max(240)).max(10).default([]),
  steps: z.array(z.string().min(2).max(240)).min(2).max(8),
  tests: z.array(z.string().min(2).max(200)).max(6).default([]),
  risks: z.array(z.string().min(2).max(200)).max(6).default([]),
  acceptance: z.array(z.string().min(2).max(200)).max(6).default([]),
})

export type IssuePlan = z.infer<typeof issuePlanSchema>

export interface StoredIssuePlan {
  plan: IssuePlan
  repo: string
  issueNumber: number
  issueTitle: string
  generatedAt: string
  model?: string | null
  providerId?: string | null
  promptVersion?: string | null
}

const SYSTEM_PROMPT = `你是资深工程师，擅长把一个 Issue 拆成可执行的修复方案。用户会给出 Issue、项目上下文和仓库文件列表。
任务：分析问题，给出修复计划。不要直接写代码补丁，不要假设看不见的文件内容。

规则：
- summary：用几句话说明问题可能的原因和修复方向。
- likelyFiles：只能从给定文件列表里选择，最多 6 个；不确定就少给。
- steps：3-6 条实现步骤，具体到模块或函数，但不要编造代码。
- tests：需要新增或运行的测试。
- risks：可能的回归、兼容性或数据风险。
- acceptance：可验证的完成标准。
- 如果信息不足，明确写出需要先向用户确认的问题，不要硬猜。

只输出一个合法 JSON 对象，不要 Markdown 围栏或解释：
{
  "summary": "...",
  "likelyFiles": ["src/..."],
  "steps": ["..."],
  "tests": ["..."],
  "risks": ["..."],
  "acceptance": ["..."]
}`

function apiBase(): string {
  return (process.env.GITHUB_API_BASE?.trim() || 'https://api.github.com').replace(/\/+$/, '')
}

function headers(token: string | null): Record<string, string> {
  return {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'repo-radar',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  }
}

async function githubJson<T>(token: string | null, path: string): Promise<T | null> {
  try {
    const response = await fetch(`${apiBase()}${path}`, {
      headers: headers(token),
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    } as RequestInit & { cache: 'no-store' })
    if (!response.ok) return null
    return (await response.json()) as T
  } catch {
    return null
  }
}

function relevantFile(path: string): boolean {
  return !/(^|\/)(node_modules|\.git|dist|build|coverage|vendor|target|\.next)(\/|$)/i.test(path)
}

export async function fetchIssueContext(
  token: string | null,
  repo: string,
  number: number,
): Promise<IssueContext | null> {
  const issue = await githubJson<{
    number?: number
    title?: string
    body?: string | null
    labels?: Array<{ name?: string }>
    user?: { login?: string }
    pull_request?: unknown
  }>(token, `/repos/${repo}/issues/${number}`)
  if (!issue || issue.pull_request) return null

  const comments =
    (await githubJson<Array<{ user?: { login?: string }; body?: string | null }>>(
      token,
      `/repos/${repo}/issues/${number}/comments?per_page=20`,
    )) ?? []

  const repoInfo = await githubJson<{ default_branch?: string }>(token, `/repos/${repo}`)
  const branch = repoInfo?.default_branch?.trim() || 'HEAD'
  const tree = await githubJson<{ tree?: Array<{ path?: string; type?: string }> }>(
    token,
    `/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
  )
  const files = (tree?.tree ?? [])
    .filter((entry) => entry.type === 'blob' && entry.path && relevantFile(entry.path))
    .map((entry) => entry.path!)
    .slice(0, 180)

  return {
    repo,
    number: issue.number ?? number,
    title: issue.title ?? `Issue #${number}`,
    body: issue.body?.slice(0, 5000) ?? null,
    labels: (issue.labels ?? []).map((label) => label.name ?? '').filter(Boolean),
    author: issue.user?.login ?? null,
    comments: comments
      .map((comment) => ({ author: comment.user?.login ?? '', body: comment.body?.slice(0, 1200) ?? '' }))
      .filter((comment) => comment.body),
    files,
  }
}

function compact(context: IssueContext, project: IssueProjectContext) {
  return {
    repo: context.repo,
    issue: {
      number: context.number,
      title: context.title,
      body: context.body,
      labels: context.labels,
      author: context.author,
      comments: context.comments.slice(0, 8),
    },
    project: {
      description: project.description,
      language: project.language,
      topics: project.topics.slice(0, 10),
      readme: project.readme?.slice(0, 2600) ?? null,
      manifestName: project.manifestName,
      manifest: project.manifest?.slice(0, 1600) ?? null,
    },
    files: context.files.slice(0, 140),
  }
}

export function buildIssuePlanPrompt(context: IssueContext, project: IssueProjectContext): string {
  return `请为这个 Issue 生成修复方案：\n\n${JSON.stringify(compact(context, project), null, 2)}`
}

export function parseIssuePlan(raw: string): IssuePlan {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim()
  let lastError: string | null = null

  for (const candidate of extractJsonObjects(cleaned)) {
    let parsed: unknown
    try {
      parsed = JSON.parse(candidate)
    } catch {
      continue
    }
    if (typeof parsed !== 'object' || parsed === null) continue
    if (!Array.isArray((parsed as Record<string, unknown>).steps)) continue

    const result = issuePlanSchema.safeParse(parsed)
    if (result.success) return result.data
    const issue = result.error.issues[0]
    lastError = `${issue?.path.join('.') ?? 'unknown'} ${issue?.message ?? ''}`
  }

  if (lastError) throw new Error(`修复方案结构不符合要求：${lastError}`)
  throw new Error('模型返回的 JSON 无法解析（可能被截断或混入了说明文字）')
}

export function groundIssuePlan(plan: IssuePlan, context: IssueContext): IssuePlan {
  if (context.files.length === 0) return plan
  const files = new Set(context.files)
  return { ...plan, likelyFiles: plan.likelyFiles.filter((file) => files.has(file)) }
}

export async function generateIssuePlan(
  context: IssueContext,
  project: IssueProjectContext,
  llm: LlmConfig,
): Promise<IssuePlan> {
  const prompt = buildIssuePlanPrompt(context, project)
  const messages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    { role: 'user' as const, content: prompt },
  ]

  let raw = await chatCompletion(llm, messages, { temperature: 0.3, maxTokens: 4000, jsonMode: true })
  let plan: IssuePlan | null = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      plan = parseIssuePlan(raw)
      break
    } catch (error) {
      console.error(`[issue-plan] 第 ${attempt + 1} 次输出解析失败：`, error, '\n', raw.slice(0, 900))
      if (attempt === 1) break
      raw = await chatCompletion(
        llm,
        [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `${prompt}\n\n上一次输出不是合法 JSON，只输出 JSON 对象。` },
        ],
        { temperature: 0.2, maxTokens: 5000, jsonMode: true },
      )
    }
  }
  if (!plan) throw new Error('模型没有返回合法 JSON（已自动重试）')
  return groundIssuePlan(plan, context)
}

export async function saveIssuePlan(
  pool: DbPool,
  userId: number,
  payload: StoredIssuePlan,
): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO issue_plans (user_id, repo_full_name, issue_number, payload)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [userId, payload.repo, payload.issueNumber, JSON.stringify(payload)],
  )
  return Number(rows[0]?.id ?? 0)
}

export async function findLatestIssuePlan(
  pool: DbPool,
  userId: number,
  repo: string,
  issueNumber: number,
): Promise<StoredIssuePlan | null> {
  const { rows } = await pool.query<{ payload: StoredIssuePlan }>(
    `SELECT payload FROM issue_plans
     WHERE user_id = $1 AND repo_full_name = $2 AND issue_number = $3
     ORDER BY created_at DESC LIMIT 1`,
    [userId, repo, issueNumber],
  )
  return rows[0]?.payload ?? null
}

export function buildIssuePlanBrief(payload: StoredIssuePlan): string {
  const { plan } = payload
  const lines = [
    `# RepoRadar Issue 修复任务书 · ${payload.repo} #${payload.issueNumber}`,
    '',
    `> Issue：${payload.issueTitle}`,
    `> 生成时间：${payload.generatedAt}`,
    '',
    '你是一名负责修复这个 Issue 的工程师。请先核实下面的分析，再开始改动。',
    '',
    '## 问题判断',
    '',
    plan.summary,
    '',
  ]

  if (plan.likelyFiles.length > 0) {
    lines.push('## 可能涉及的文件', '')
    for (const file of plan.likelyFiles) {
      lines.push(`- [${file}](https://github.com/${payload.repo}/blob/HEAD/${file})`)
    }
    lines.push('')
  }

  lines.push('## 实现步骤', '')
  plan.steps.forEach((step, index) => lines.push(`${index + 1}. ${step}`))
  if (plan.tests.length > 0) {
    lines.push('', '## 测试', '')
    for (const test of plan.tests) lines.push(`- ${test}`)
  }
  if (plan.risks.length > 0) {
    lines.push('', '## 风险', '')
    for (const risk of plan.risks) lines.push(`- ${risk}`)
  }
  if (plan.acceptance.length > 0) {
    lines.push('', '## 验收标准', '')
    for (const item of plan.acceptance) lines.push(`- ${item}`)
  }

  lines.push(
    '',
    '## 执行要求',
    '',
    '1. 先读相关文件和测试，确认问题根因；如果信息不足，先列出需要向用户确认的问题。',
    '2. 只做与这个 Issue 相关的最小改动，保持现有代码风格。',
    '3. 补测试并运行项目已有的 test / lint / typecheck / build。',
    '4. 不要自动提交、推送、开 PR 或关闭 Issue；这些动作需要人工确认。',
    '5. 最后给出改动摘要、验证结果和未完成项。',
    '',
    '由 RepoRadar 生成。方案基于 Issue 和文件列表推断，执行前请核实。',
  )
  return lines.join('\n')
}

export async function findIssuePlanById(
  pool: DbPool,
  userId: number,
  id: number,
): Promise<StoredIssuePlan | null> {
  const { rows } = await pool.query<{ payload: StoredIssuePlan }>(
    `SELECT payload FROM issue_plans WHERE user_id = $1 AND id = $2 LIMIT 1`,
    [userId, id],
  )
  return rows[0]?.payload ?? null
}
