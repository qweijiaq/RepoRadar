import { z } from 'zod'
import type { LlmConfig } from './config.js'
import type { DbPool } from './db.js'
import type { DependencyCheck } from './dependency-radar.js'
import { extractJsonObjects } from './integrations.js'
import { chatCompletion } from './llm.js'

export interface MaintainerSignals {
  stars: number
  forks: number
  openIssues: number
  openPulls: number
  lastPushedAt: string | null
  archived: boolean
  license: string | null
  hasTests: boolean
  hasCi: boolean
}

export interface MaintainerItemInput {
  kind: 'issue' | 'pull'
  number: number
  title: string
  labels: string[]
  comments: number
  ageDays: number
  body: string | null
  draft: boolean | null
}

export interface MaintainerProjectInput {
  repo: string
  description: string
  language: string | null
  topics: string[]
  readme: string | null
  manifestName: string | null
  manifest: string | null
  dependencies: DependencyCheck[]
  signals: MaintainerSignals
  items: MaintainerItemInput[]
}

export interface MaintainerSnapshot {
  signals: MaintainerSignals
  items: MaintainerItemInput[]
  warnings: string[]
}

export const maintainerDependencySchema = z.object({
  name: z.string().min(1).max(120),
  current: z.string().max(60).nullable().default(null),
  latest: z.string().max(60).nullable().default(null),
  risk: z.enum(['major', 'minor', 'patch', 'unknown']).default('unknown'),
  reason: z.string().min(4).max(240),
  steps: z.array(z.string().min(2).max(180)).max(3).default([]),
  vulnerabilities: z.array(z.string().max(120)).max(3).default([]),
})

export const maintainerItemSchema = z.object({
  kind: z.enum(['issue', 'pull']),
  number: z.number().int().positive(),
  title: z.string().min(2).max(200),
  priority: z.enum(['now', 'week', 'later']),
  reason: z.string().min(4).max(240),
  action: z.string().min(2).max(200),
  draft: z.string().max(500).default(''),
})

export const maintainerProjectSchema = z.object({
  repo: z.string().min(3).max(120),
  healthScore: z.number().int().min(0).max(100),
  summary: z.string().min(4).max(300),
  strengths: z.array(z.string().min(2).max(160)).max(5).default([]),
  risks: z.array(z.string().min(2).max(160)).max(5).default([]),
  actions: z.array(z.string().min(2).max(200)).max(5).default([]),
  dependencies: z.array(maintainerDependencySchema).max(6).default([]),
  items: z.array(maintainerItemSchema).max(8).default([]),
})

export const maintainerReportSchema = z.object({
  projects: z.array(maintainerProjectSchema).min(1).max(5),
})

export type MaintainerDependency = z.infer<typeof maintainerDependencySchema>
export type MaintainerItem = z.infer<typeof maintainerItemSchema>
export type MaintainerProject = z.infer<typeof maintainerProjectSchema>
export type MaintainerReport = z.infer<typeof maintainerReportSchema>

export interface StoredMaintainerReport {
  report: MaintainerReport
  usedProjects: string[]
  warnings: string[]
  generatedAt: string
  model?: string | null
  providerId?: string | null
}

const DAY_MS = 86_400_000

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

function daysSince(value: string | null): number {
  if (!value) return 0
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return 0
  return Math.max(0, Math.floor((Date.now() - time) / DAY_MS))
}

interface RepoPayload {
  stargazers_count?: number
  forks_count?: number
  open_issues_count?: number
  pushed_at?: string | null
  archived?: boolean
  license?: { spdx_id?: string | null } | null
}

interface ItemPayload {
  number: number
  title: string
  body?: string | null
  labels?: Array<{ name?: string }>
  comments?: number
  review_comments?: number
  created_at?: string
  updated_at?: string
  pull_request?: unknown
  draft?: boolean
}

/**
 * 拉取维护者周报需要的 GitHub 信号：仓库状态、根目录结构、Issue 和 PR。
 */
export async function fetchMaintainerSnapshot(
  token: string | null,
  fullName: string,
): Promise<MaintainerSnapshot> {
  const warnings: string[] = []
  const repo = await githubJson<RepoPayload>(token, `/repos/${fullName}`)
  if (!repo) warnings.push(`${fullName}：无法读取仓库状态`)

  const contents = await githubJson<Array<{ name?: string; type?: string }>>(
    token,
    `/repos/${fullName}/contents/`,
  )
  const names = new Set((contents ?? []).map((entry) => entry.name?.toLowerCase()).filter(Boolean))
  const hasTests = ['test', 'tests', '__tests__', 'spec', 'specs'].some((name) => names.has(name))
  const hasCi = names.has('.github')

  const issuePayloads =
    (await githubJson<ItemPayload[]>(
      token,
      `/repos/${fullName}/issues?state=open&per_page=25&sort=updated&direction=desc`,
    )) ?? []
  if (issuePayloads.length === 0 && !repo) warnings.push(`${fullName}：无法读取 Issue`)

  const pullPayloads =
    (await githubJson<ItemPayload[]>(
      token,
      `/repos/${fullName}/pulls?state=open&per_page=15&sort=updated&direction=desc`,
    )) ?? []

  const items = new Map<string, MaintainerItemInput>()
  for (const issue of issuePayloads) {
    if (issue.pull_request) continue
    items.set(`issue:${issue.number}`, {
      kind: 'issue',
      number: issue.number,
      title: issue.title,
      labels: (issue.labels ?? []).map((label) => label.name ?? '').filter(Boolean).slice(0, 6),
      comments: issue.comments ?? 0,
      ageDays: daysSince(issue.updated_at ?? issue.created_at ?? null),
      body: issue.body?.slice(0, 500) ?? null,
      draft: null,
    })
  }
  for (const pull of pullPayloads) {
    items.set(`pull:${pull.number}`, {
      kind: 'pull',
      number: pull.number,
      title: pull.title,
      labels: (pull.labels ?? []).map((label) => label.name ?? '').filter(Boolean).slice(0, 6),
      comments: pull.comments ?? 0,
      ageDays: daysSince(pull.updated_at ?? pull.created_at ?? null),
      body: pull.body?.slice(0, 400) ?? null,
      draft: Boolean(pull.draft),
    })
  }

  return {
    signals: {
      stars: repo?.stargazers_count ?? 0,
      forks: repo?.forks_count ?? 0,
      openIssues: repo?.open_issues_count ?? items.size,
      openPulls: pullPayloads.length,
      lastPushedAt: repo?.pushed_at ?? null,
      archived: repo?.archived ?? false,
      license: repo?.license?.spdx_id ?? null,
      hasTests,
      hasCi,
    },
    items: [...items.values()].slice(0, 35),
    warnings,
  }
}

const SYSTEM_PROMPT = `你是经验丰富的开源维护者助手。用户会给出他正在维护的项目：README、依赖、GitHub 信号（测试/CI/issue/PR）和依赖版本检查结果。
任务：为每个项目生成一份「维护周报」，帮助维护者决定这周先做什么。

规则：
- healthScore 0-100：综合测试、CI、Issue/PR 积压、依赖风险和维护活跃度；不要虚高。
- strengths / risks / actions 各 3-5 条，具体、可执行。
- dependencies 只从输入的 dependencies 里挑选真正需要升级或有安全公告的，最多 4 条；说明风险与升级步骤；有 vulnerabilities 时必须优先说明。
- items 只引用输入里的 issue / pull，不得编造编号；priority 只能是 now / week / later，最多 6 条。
- draft 是给维护者参考的回复或 review 草稿，中文，<=120 字；没有把握就留空。
- 不要建议自动删除仓库、自动发布或强推 main。

只输出一个合法 JSON 对象，不要 Markdown 围栏或解释：
{
  "projects": [
    {
      "repo": "owner/name",
      "healthScore": 72,
      "summary": "项目健康度概览",
      "strengths": ["..."],
      "risks": ["..."],
      "actions": ["..."],
      "dependencies": [
        { "name": "pkg", "current": "^1.0.0", "latest": "2.0.0", "risk": "major", "reason": "...", "steps": ["..."] }
      ],
      "items": [
        { "kind": "issue|pull", "number": 42, "title": "...", "priority": "now|week|later", "reason": "...", "action": "...", "draft": "..." }
      ]
    }
  ]
}`

function compactProject(project: MaintainerProjectInput) {
  return {
    repo: project.repo,
    description: project.description,
    language: project.language,
    topics: project.topics.slice(0, 10),
    readme: project.readme?.slice(0, 2200) ?? null,
    manifestName: project.manifestName,
    manifest: project.manifest?.slice(0, 1400) ?? null,
    signals: project.signals,
    dependencies: project.dependencies.map((dependency) => ({
      name: dependency.name,
      ecosystem: dependency.ecosystem,
      dev: dependency.dev,
      declared: dependency.declared,
      installed: dependency.installed,
      latest: dependency.latest,
      outdated: dependency.outdated,
      risk: dependency.risk,
      repo: dependency.repo,
      deprecated: dependency.deprecated,
      releaseNotes: dependency.releaseNotes?.slice(0, 900) ?? null,
      vulnerabilities: dependency.vulnerabilities.map((vuln) => `${vuln.id}${vuln.summary ? `：${vuln.summary}` : ''}`),
    })),
    items: project.items.map((item) => ({
      ...item,
      body: item.body?.slice(0, 360) ?? null,
    })),
  }
}

export function buildMaintainerPrompt(projects: MaintainerProjectInput[]): string {
  return `以下是维护中的项目（JSON）。请生成维护周报：\n\n${JSON.stringify(
    projects.map(compactProject),
    null,
    2,
  )}`
}

function relaxReport(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.projects)) return value

  return {
    ...record,
    projects: record.projects.map((project) => {
      if (typeof project !== 'object' || project === null) return project
      const entry = project as Record<string, unknown>
      const array = (key: string) =>
        Array.isArray(entry[key])
          ? (entry[key] as unknown[]).filter((item) => typeof item === 'string' && item.length >= 2)
          : []
      return {
        ...entry,
        strengths: array('strengths').slice(0, 5),
        risks: array('risks').slice(0, 5),
        actions: array('actions').slice(0, 5),
        dependencies: Array.isArray(entry.dependencies)
          ? entry.dependencies.filter((item) => maintainerDependencySchema.safeParse(item).success)
          : [],
        items: Array.isArray(entry.items)
          ? entry.items.filter((item) => maintainerItemSchema.safeParse(item).success)
          : [],
      }
    }),
  }
}

export function parseMaintainerReport(raw: string): MaintainerReport {
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
    if (!Array.isArray((parsed as Record<string, unknown>).projects)) continue

    const strict = maintainerReportSchema.safeParse(parsed)
    if (strict.success) return strict.data
    const relaxed = maintainerReportSchema.safeParse(relaxReport(parsed))
    if (relaxed.success) return relaxed.data
    const issue = relaxed.error.issues[0]
    lastError = `${issue?.path.join('.') ?? 'unknown'} ${issue?.message ?? ''}`
  }

  if (lastError) throw new Error(`维护周报结构不符合要求：${lastError}`)
  throw new Error('模型返回的 JSON 无法解析（可能被截断或混入了说明文字）')
}

export function groundMaintainerReport(
  report: MaintainerReport,
  projects: MaintainerProjectInput[],
): MaintainerReport {
  const projectMap = new Map(projects.map((project) => [project.repo.toLowerCase(), project]))

  return {
    projects: report.projects
      .filter((project) => projectMap.has(project.repo.toLowerCase()))
      .map((project) => {
        const input = projectMap.get(project.repo.toLowerCase())!
        const dependencyNames = new Set(input.dependencies.map((dependency) => dependency.name.toLowerCase()))
        const itemKeys = new Set(input.items.map((item) => `${item.kind}:${item.number}`))
        return {
          ...project,
          dependencies: project.dependencies.filter((dependency) =>
            dependencyNames.has(dependency.name.toLowerCase()),
          ),
          items: project.items.filter((item) => itemKeys.has(`${item.kind}:${item.number}`)),
        }
      }),
  }
}

export async function generateMaintainerReport(
  projects: MaintainerProjectInput[],
  llm: LlmConfig,
): Promise<MaintainerReport> {
  const userPrompt = buildMaintainerPrompt(projects)
  const messages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    { role: 'user' as const, content: userPrompt },
  ]

  let raw = await chatCompletion(llm, messages, { temperature: 0.3, maxTokens: 9000, jsonMode: true })
  let report: MaintainerReport | null = null

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      report = parseMaintainerReport(raw)
      break
    } catch (error) {
      console.error(
        `[maintainer] 第 ${attempt + 1} 次模型输出解析失败：`,
        error,
        '\n--- 输出开头 ---\n',
        raw.slice(0, 1200),
      )
      if (attempt === 1) break
      raw = await chatCompletion(
        llm,
        [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `${userPrompt}\n\n上一次输出不是合法 JSON。请只输出一个合法 JSON 对象，不要解释；每个项目最多 4 条依赖、6 条 issue/PR，内容精简。`,
          },
        ],
        { temperature: 0.2, maxTokens: 9000, jsonMode: true },
      )
    }
  }

  if (!report) throw new Error('模型没有返回合法 JSON（已自动重试）。可以换一个模型再试')
  const grounded = groundMaintainerReport(report, projects)
  if (grounded.projects.length === 0) throw new Error('模型没有返回任何有效项目的维护周报')
  return grounded
}


function normalizeStoredReport(payload: StoredMaintainerReport): StoredMaintainerReport {
  return {
    ...payload,
    usedProjects: payload.usedProjects ?? [],
    warnings: payload.warnings ?? [],
    report: {
      projects: (payload.report?.projects ?? []).map((project) => ({
        ...project,
        strengths: project.strengths ?? [],
        risks: project.risks ?? [],
        actions: project.actions ?? [],
        dependencies: (project.dependencies ?? []).map((dependency) => ({
          ...dependency,
          steps: dependency.steps ?? [],
          vulnerabilities: dependency.vulnerabilities ?? [],
        })),
        items: (project.items ?? []).map((item) => ({
          ...item,
          draft: item.draft ?? '',
        })),
      })),
    },
  }
}

export async function saveMaintainerReport(
  pool: DbPool,
  userId: number,
  payload: StoredMaintainerReport,
): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO maintainer_reports (user_id, payload) VALUES ($1, $2) RETURNING id`,
    [userId, JSON.stringify(payload)],
  )
  return Number(rows[0]?.id ?? 0)
}

export async function findLatestMaintainerReport(
  pool: DbPool,
  userId: number,
): Promise<StoredMaintainerReport | null> {
  const { rows } = await pool.query<{ payload: StoredMaintainerReport }>(
    `SELECT payload FROM maintainer_reports WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [userId],
  )
  const payload = rows[0]?.payload
  return payload ? normalizeStoredReport(payload) : null
}

export async function findMaintainerReportById(
  pool: DbPool,
  userId: number,
  id: number,
): Promise<StoredMaintainerReport | null> {
  const { rows } = await pool.query<{ payload: StoredMaintainerReport }>(
    `SELECT payload FROM maintainer_reports WHERE user_id = $1 AND id = $2 LIMIT 1`,
    [userId, id],
  )
  const payload = rows[0]?.payload
  return payload ? normalizeStoredReport(payload) : null
}
