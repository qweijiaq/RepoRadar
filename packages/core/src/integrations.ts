import { z } from 'zod'
import type { LlmConfig } from './config.js'
import type { DbPool } from './db.js'
import { chatCompletion } from './llm.js'
import { parseGeneratedPatch } from './patch.js'

export interface IntegrationProjectInput {
  repo: string
  description: string
  language: string | null
  topics: string[]
  dependencies: string[]
  readme: string | null
  manifestName: string | null
  manifest: string | null
  lockfileName?: string | null
  lockfile?: string | null
}

export interface IntegrationCandidate {
  repo: string
  summary: string
  language: string | null
  topics: string[]
  stars: number
  verified: boolean
  reason: string | null
  alreadyUsed: boolean
}

export interface IntegrationOutcomeSignal {
  projectFullName: string
  suggestionRepo: string
  status: 'adopted' | 'rejected'
}

export const integrationSuggestionSchema = z.object({
  repo: z.string().min(3).max(120),
  kind: z.enum(['missing', 'optimize']),
  reason: z.string().min(4).max(300),
  action: z.enum(['try', 'watch']).default('try'),
  steps: z.array(z.string().min(2).max(200)).max(4).default([]),
  alreadyUsed: z.boolean().default(false),
})

export const integrationProjectSchema = z.object({
  repo: z.string().min(3).max(120),
  summary: z.string().min(4).max(300),
  gaps: z.array(z.string().min(2).max(160)).max(5).default([]),
  suggestions: z.array(integrationSuggestionSchema).max(5).default([]),
})

export const integrationReportSchema = z.object({
  projects: z.array(integrationProjectSchema).min(1).max(5),
})

export type IntegrationSuggestion = z.infer<typeof integrationSuggestionSchema>
export type IntegrationProject = z.infer<typeof integrationProjectSchema>
export type IntegrationReport = z.infer<typeof integrationReportSchema>

export interface StoredIntegrationReport {
  report: IntegrationReport
  usedProjects: string[]
  auto: boolean
  focus: string | null
  generatedAt: string
  model?: string | null
  providerId?: string | null
  promptVersion?: string | null
  candidateCount?: number
  candidateRepos?: string[]
}

const SYSTEM_PROMPT = `你是资深架构师兼开源选型顾问。用户会给出他正在维护的项目（README、依赖、元数据）和候选开源仓库列表。
任务：对每个项目，先找出 3-5 个能力缺口或可优化点，然后只从候选列表中挑选 2-5 个可以接入的项目。

分类规则：
- missing：当前项目没有这项能力，接入候选可以补足。
- optimize：当前项目已有类似能力，但候选更成熟/更活跃/更合适，可以替换或优化。
- 如果候选的 alreadyUsed=true，说明项目依赖里已经有它，只能作为 optimize（升级/替换）建议，不要当作 missing。
- 不要推荐项目自身。
- 不要推荐 awesome-list、教程、清单、合集类仓库；优先中小型、维护活跃、可以真正接入的库。
- reason 要具体说明当前项目缺什么、候选补了什么，不要泛泛而谈。
- steps 给出 1-3 条可执行的接入步骤（安装、替换位置、配置方式），要具体。
- 每个项目最多 5 条建议，每条 steps 最多 3 条，内容尽量精简。
- 建议尽量覆盖不同方向，不要用 5 个同类库凑数；没有足够合适的候选就少给。
- 只能引用候选列表中的仓库全名，不得编造。

只输出一个合法 JSON 对象，不要 Markdown 围栏、不要解释、不要输出思考过程：
{
  "projects": [
    {
      "repo": "owner/name",
      "summary": "这个项目在做什么（中文，<=80字）",
      "gaps": ["能力缺口或可优化点"],
      "suggestions": [
        {
          "repo": "owner/name",
          "kind": "missing|optimize",
          "reason": "为什么适合接入",
          "action": "try|watch",
          "steps": ["接入步骤"]
        }
      ]
    }
  ]
}`

function compactProjects(projects: IntegrationProjectInput[]) {
  return projects.map((project) => ({
    repo: project.repo,
    description: project.description,
    language: project.language,
    topics: project.topics.slice(0, 12),
    dependencies: project.dependencies.slice(0, 40),
    readme: project.readme ? project.readme.slice(0, 2500) : null,
    manifestName: project.manifestName,
    manifest: project.manifest ? project.manifest.slice(0, 1500) : null,
  }))
}

function compactCandidates(candidates: IntegrationCandidate[]) {
  return candidates.map((candidate) => ({
    repo: candidate.repo,
    summary: candidate.summary.slice(0, 160),
    language: candidate.language,
    topics: candidate.topics.slice(0, 6),
    stars: candidate.stars,
    verified: candidate.verified,
    alreadyUsed: candidate.alreadyUsed,
    reason: candidate.reason,
  }))
}

export function buildIntegrationPrompt(
  projects: IntegrationProjectInput[],
  candidates: IntegrationCandidate[],
  focus: string | null = null,
  outcomes: IntegrationOutcomeSignal[] = [],
): string {
  const focusLine = focus ? `\n本轮重点关注：${focus}\n` : ''
  const adopted = outcomes.filter((outcome) => outcome.status === 'adopted')
  const rejected = outcomes.filter((outcome) => outcome.status === 'rejected')
  const historyLines: string[] = []

  if (adopted.length > 0) {
    historyLines.push(
      '用户之前采纳过这些接入建议（同类方向可以优先，但不要机械重复）：',
      ...adopted.map((outcome) => `- ${outcome.projectFullName} → ${outcome.suggestionRepo}`),
    )
  }
  if (rejected.length > 0) {
    historyLines.push(
      '用户明确拒绝过这些候选，不要在同一项目里再次推荐：',
      ...rejected.map((outcome) => `- ${outcome.projectFullName} → ${outcome.suggestionRepo}`),
    )
  }
  const history = historyLines.length > 0 ? `\n${historyLines.join('\n')}\n` : ''

  return `${focusLine}${history}以下是用户正在维护的项目和候选仓库（JSON）。请据此生成接入建议：\n\n${JSON.stringify(
    { projects: compactProjects(projects), candidates: compactCandidates(candidates) },
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
    projects: record.projects.slice(0, 5).map((project) => {
      if (typeof project !== 'object' || project === null) return project
      const entry = project as Record<string, unknown>
      const gaps = Array.isArray(entry.gaps)
        ? entry.gaps.filter((gap) => typeof gap === 'string' && gap.length >= 2 && gap.length <= 160)
        : []
      const suggestions = Array.isArray(entry.suggestions)
        ? entry.suggestions
            .filter((suggestion) => integrationSuggestionSchema.safeParse(suggestion).success)
            .slice(0, 5)
        : []
      return { ...entry, gaps, suggestions }
    }),
  }
}

export function extractJsonObjects(text: string): string[] {
  const objects: string[] = []
  let start = text.indexOf('{')

  while (start !== -1) {
    let depth = 0
    let inString = false
    let escaped = false
    let end = -1

    for (let index = start; index < text.length; index++) {
      const char = text[index]
      if (inString) {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === '"') inString = false
        continue
      }
      if (char === '"') inString = true
      else if (char === '{') depth++
      else if (char === '}') {
        depth--
        if (depth === 0) {
          end = index
          break
        }
      }
    }

    if (end === -1) {
      start = text.indexOf('{', start + 1)
      continue
    }
    objects.push(text.slice(start, end + 1))
    start = text.indexOf('{', end + 1)
  }

  return objects
}

export function parseIntegrationReport(raw: string): IntegrationReport {
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
    const projects = (parsed as Record<string, unknown>).projects
    if (!Array.isArray(projects)) continue

    const strict = integrationReportSchema.safeParse(parsed)
    if (strict.success) return strict.data

    const relaxed = integrationReportSchema.safeParse(relaxReport(parsed))
    if (relaxed.success) return relaxed.data

    const issue = relaxed.error.issues[0]
    lastError = `${issue?.path.join('.') ?? 'unknown'} ${issue?.message ?? ''}`
  }

  if (lastError) throw new Error(`接入建议结构不符合要求：${lastError}`)
  throw new Error('模型返回的 JSON 无法解析（可能被截断或混入了说明文字）')
}

export function groundIntegrationReport(
  report: IntegrationReport,
  projectNames: string[],
  candidateNames: string[],
): IntegrationReport {
  const projects = new Set(projectNames.map((name) => name.toLowerCase()))
  const candidates = new Set(candidateNames.map((name) => name.toLowerCase()))

  return {
    projects: report.projects
      .filter((project) => projects.has(project.repo.toLowerCase()))
      .map((project) => ({
        ...project,
        suggestions: project.suggestions.filter((suggestion) => candidates.has(suggestion.repo.toLowerCase())),
      })),
  }
}

export function applyCandidateFlags(
  report: IntegrationReport,
  candidates: IntegrationCandidate[],
): IntegrationReport {
  const candidateMap = new Map(candidates.map((candidate) => [candidate.repo.toLowerCase(), candidate]))

  return {
    projects: report.projects.map((project) => ({
      ...project,
      suggestions: project.suggestions.map((suggestion) => ({
        ...suggestion,
        alreadyUsed: candidateMap.get(suggestion.repo.toLowerCase())?.alreadyUsed ?? false,
      })),
    })),
  }
}

export function filterHandledSuggestions(
  report: IntegrationReport,
  outcomes: IntegrationOutcomeSignal[],
): IntegrationReport {
  const handled = new Set(
    outcomes.map(
      (outcome) => `${outcome.projectFullName.toLowerCase()}|${outcome.suggestionRepo.toLowerCase()}`,
    ),
  )
  return {
    projects: report.projects.map((project) => ({
      ...project,
      suggestions: project.suggestions.filter(
        (suggestion) => !handled.has(`${project.repo.toLowerCase()}|${suggestion.repo.toLowerCase()}`),
      ),
    })),
  }
}

/** @deprecated 使用 filterHandledSuggestions；保留旧名给已有调用。 */
export const filterRejectedSuggestions = filterHandledSuggestions

export async function generateIntegrationReport(
  projects: IntegrationProjectInput[],
  candidates: IntegrationCandidate[],
  llm: LlmConfig,
  focus: string | null = null,
  outcomes: IntegrationOutcomeSignal[] = [],
): Promise<IntegrationReport> {
  const userPrompt = buildIntegrationPrompt(projects, candidates, focus, outcomes)
  const messages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    { role: 'user' as const, content: userPrompt },
  ]

  let raw = await chatCompletion(llm, messages, { temperature: 0.4, maxTokens: 8000, jsonMode: true })
  let report: IntegrationReport | null = null

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      report = parseIntegrationReport(raw)
      break
    } catch (error) {
      console.error(
        `[integrations] 第 ${attempt + 1} 次模型输出解析失败：`,
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
            content: `${userPrompt}\n\n上一次输出不是合法 JSON。请只输出一个合法 JSON 对象，不要 Markdown 围栏或解释；每个项目最多 5 条建议，每条 steps 最多 3 条，内容尽量精简。`,
          },
        ],
        { temperature: 0.2, maxTokens: 8000, jsonMode: true },
      )
    }
  }

  if (!report) throw new Error('模型没有返回合法 JSON（已自动重试）。可以换一个模型再试')

  const grounded = groundIntegrationReport(
    report,
    projects.map((project) => project.repo),
    candidates.map((candidate) => candidate.repo),
  )
  if (grounded.projects.length === 0) throw new Error('模型没有返回任何有效项目的建议')

  return filterHandledSuggestions(applyCandidateFlags(grounded, candidates), outcomes)
}

const DAY_MS = 86_400_000

export function buildDiscoveryQueries(
  projects: IntegrationProjectInput[],
  options: { minStars?: number; days?: number; maxQueries?: number; now?: Date } = {},
): string[] {
  const minStars = options.minStars ?? 50
  const days = options.days ?? 180
  const since = new Date((options.now ?? new Date()).getTime() - days * DAY_MS).toISOString().slice(0, 10)
  const queries = new Set<string>()

  for (const project of projects) {
    for (const topic of project.topics.slice(0, 4)) {
      const language = project.language ? ` language:${project.language}` : ''
      queries.add(
        `topic:${topic}${language} stars:>=${minStars} pushed:>=${since} archived:false fork:false`,
      )
    }
  }

  return [...queries].slice(0, options.maxQueries ?? 10)
}

export function isDependencyUsed(repoFullName: string, dependencies: string[]): boolean {
  const fullName = repoFullName.toLowerCase()
  const name = fullName.split('/')[1] ?? ''
  const dependencySet = new Set(dependencies.map((dependency) => dependency.toLowerCase().replace(/^@/, '')))
  return dependencySet.has(fullName) || (name.length > 0 && dependencySet.has(name))
}


function normalizeStoredIntegrationReport(payload: StoredIntegrationReport): StoredIntegrationReport {
  return {
    ...payload,
    usedProjects: payload.usedProjects ?? [],
    focus: payload.focus ?? null,
    report: {
      projects: (payload.report?.projects ?? []).map((project) => ({
        ...project,
        gaps: project.gaps ?? [],
        suggestions: (project.suggestions ?? []).map((suggestion) => ({
          ...suggestion,
          steps: suggestion.steps ?? [],
          alreadyUsed: suggestion.alreadyUsed ?? false,
        })),
      })),
    },
  }
}

export async function saveIntegrationReport(
  pool: DbPool,
  userId: number,
  payload: StoredIntegrationReport,
): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO integration_reports (user_id, payload) VALUES ($1, $2) RETURNING id`,
    [userId, JSON.stringify(payload)],
  )
  return Number(rows[0]?.id ?? 0)
}

export async function findLatestIntegrationReport(
  pool: DbPool,
  userId: number,
): Promise<StoredIntegrationReport | null> {
  const { rows } = await pool.query<{ payload: StoredIntegrationReport }>(
    `SELECT payload FROM integration_reports WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [userId],
  )
  const payload = rows[0]?.payload
  return payload ? normalizeStoredIntegrationReport(payload) : null
}

export async function findIntegrationReportById(
  pool: DbPool,
  userId: number,
  id: number,
): Promise<StoredIntegrationReport | null> {
  const { rows } = await pool.query<{ payload: StoredIntegrationReport }>(
    `SELECT payload FROM integration_reports WHERE user_id = $1 AND id = $2 LIMIT 1`,
    [userId, id],
  )
  const payload = rows[0]?.payload
  return payload ? normalizeStoredIntegrationReport(payload) : null
}

export interface IntegrationTrialCandidate {
  repo: string
  summary: string
  language: string | null
  topics: string[]
  stars: number
}

export interface IntegrationTrialInput {
  project: string
  candidate: IntegrationTrialCandidate
  projectContext: IntegrationProjectInput
  steps: string[]
  targetFile?: { path: string; content: string } | null
  codeEvidence?: Array<{ path: string; content: string }>
}

export interface GeneratedIntegrationTrial {
  summary: string
  files: string[]
  patch: string
}

const TRIAL_SYSTEM_PROMPT = `你是一名接入工程师。任务是在用户自己的项目里做一次「试接入」补丁：
1. 在项目清单（package.json / pyproject.toml 等）里加上候选库的依赖，版本用与项目现有风格一致的兼容写法；
2. 如果给了目标文件，就在该文件里加最小可用的导入和调用；没有给目标文件时只改清单；
3. 只修改清单或给定的目标文件，不要删除现有代码，不要改锁文件；
4. 输出标准 unified diff（git apply 可直接应用），路径使用 a/ 和 b/ 前缀；
5. 必须严格输出 JSON，不要 Markdown 围栏或解释文字。

只输出一个合法 JSON 对象：
{
  "summary": "改了什么、为什么、假设是什么",
  "files": ["package.json"],
  "patch": "diff --git a/package.json b/package.json\\n--- a/package.json\\n+++ b/package.json\\n@@ ... @@\\n..."
}`

function buildTrialPrompt(input: IntegrationTrialInput): string {
  const context = input.projectContext
  return JSON.stringify(
    {
      project: input.project,
      project_language: context.language,
      project_dependencies: context.dependencies.slice(0, 40),
      manifest_file: context.manifestName,
      manifest: context.manifest?.slice(0, 6000) ?? null,
      readme_excerpt: context.readme?.slice(0, 2500) ?? null,
      candidate: {
        repo: input.candidate.repo,
        summary: input.candidate.summary,
        language: input.candidate.language,
        topics: input.candidate.topics,
        stars: input.candidate.stars,
      },
      suggested_steps: input.steps,
      target_file: input.targetFile
        ? { path: input.targetFile.path, content: input.targetFile.content.slice(0, 8000) }
        : null,
      code_evidence: (input.codeEvidence ?? []).map((item) => ({
        path: item.path,
        excerpt: item.content.slice(0, 1200),
      })),
    },
    null,
    2,
  )
}

/**
 * 生成一份「试接入」补丁：加依赖，必要时在目标文件里接一个最小调用。
 * 返回的 patch 交给 validatePatch 在沙箱里验证能否应用并构建。
 */
export async function generateIntegrationTrial(
  input: IntegrationTrialInput,
  llm: LlmConfig,
): Promise<GeneratedIntegrationTrial> {
  const prompt = buildTrialPrompt(input)
  const messages = [
    { role: 'system' as const, content: TRIAL_SYSTEM_PROMPT },
    { role: 'user' as const, content: prompt },
  ]
  let raw = await chatCompletion(llm, messages, { temperature: 0.2, maxTokens: 6000, jsonMode: true })
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return parseGeneratedPatch(raw)
    } catch (error) {
      console.error(`[integration-trial] 第 ${attempt + 1} 次输出解析失败：`, error, '\n', raw.slice(0, 900))
      if (attempt === 1) break
      raw = await chatCompletion(
        llm,
        [
          { role: 'system', content: TRIAL_SYSTEM_PROMPT },
          {
            role: 'user',
            content: `${prompt}\n\n上一次输出不是可应用的 unified diff JSON。请严格输出 JSON，patch 字段是 git apply 可用的 diff。`,
          },
        ],
        { temperature: 0.1, maxTokens: 7000, jsonMode: true },
      )
    }
  }
  throw new Error('模型没有返回可应用的接入补丁（已自动重试）')
}
