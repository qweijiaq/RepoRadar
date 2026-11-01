import { z } from 'zod'
import type { LlmConfig } from './config.js'
import type { DbPool } from './db.js'
import { extractJsonObjects } from './integrations.js'
import { chatCompletion } from './llm.js'

export interface ComparisonProjectInput {
  repo: string
  description: string
  language: string | null
  topics: string[]
  dependencies: string[]
  readme: string | null
  manifestName: string | null
  manifest: string | null
}

export interface ComparisonCandidateInput {
  repo: string
  summary: string
  language: string | null
  topics: string[]
  stars: number
  readme: string | null
}

export const comparisonCandidateSchema = z.object({
  repo: z.string().min(3).max(120),
  fitScore: z.number().int().min(0).max(100),
  strengths: z.array(z.string().min(2).max(160)).min(1).max(4),
  weaknesses: z.array(z.string().min(2).max(160)).max(4).default([]),
  migrationEffort: z.enum(['low', 'medium', 'high']).default('medium'),
  reason: z.string().min(4).max(300),
})

export const capabilitySupportSchema = z.enum(['yes', 'partial', 'no', 'unknown'])

export const comparisonCapabilitySchema = z.object({
  name: z.string().min(2).max(60),
  support: z.record(z.string(), capabilitySupportSchema).default({}),
  note: z.string().max(200).default(''),
  evidence: z.string().max(300).default(''),
})

export const comparisonReportSchema = z.object({
  project: z.string().min(3).max(120),
  summary: z.string().min(4).max(300),
  recommendation: z.object({
    repo: z.string().min(3).max(120),
    reason: z.string().min(4).max(300),
  }),
  candidates: z.array(comparisonCandidateSchema).min(2).max(5),
  nextSteps: z.array(z.string().min(2).max(200)).max(5).default([]),
  capabilities: z.array(comparisonCapabilitySchema).max(12).default([]),
})

export type ComparisonCapability = z.infer<typeof comparisonCapabilitySchema>
export type ComparisonCandidate = z.infer<typeof comparisonCandidateSchema>
export type ComparisonReport = z.infer<typeof comparisonReportSchema>

export interface StoredComparisonReport {
  report: ComparisonReport
  generatedAt: string
  model?: string | null
  providerId?: string | null
  promptVersion?: string | null
  candidateRepos?: string[]
}

const SYSTEM_PROMPT = `你是技术选型顾问。用户会给出一个正在维护的项目（README、依赖、技术栈）和 2-5 个候选开源项目。
请做一份证据导向的对比，帮助用户决定接哪个、是否值得替换现有方案。

规则：
- fitScore 0-100：候选与目标项目的技术栈、需求和维护状态的匹配度。
- strengths / weaknesses 要具体，基于给定 README 和元数据，不要编造 API。
- migrationEffort：low / medium / high，表示接入或替换的大致成本；这是初步估算，要说明依据。
- 推荐必须是候选之一；如果都不合适，也要选相对最合适的并说明保留意见。
- 不要只看 stars；考虑维护活跃度、复杂度、许可证未知的风险。
- nextSteps 给出 3-5 条验证步骤（先做 spike、读哪些文档、验证哪些接口）。
- capabilities 给一张能力差异表：5-10 行，每行一个能力维度（例如 API 覆盖、类型支持、生态、性能、维护活跃度）。
  support 的 key 必须是项目或候选的 repo 全名（原样），值是 yes / partial / no / unknown。
  每行尽量给 note 和 evidence（README 里的依据），没有依据时 evidence 留空、值用 unknown。

只输出一个合法 JSON 对象，不要 Markdown 围栏或解释：
{
  "project": "owner/name",
  "summary": "整体结论",
  "recommendation": { "repo": "owner/name", "reason": "..." },
  "candidates": [
    {
      "repo": "owner/name",
      "fitScore": 80,
      "strengths": ["..."],
      "weaknesses": ["..."],
      "migrationEffort": "low|medium|high",
      "reason": "..."
    }
  ],
  "nextSteps": ["..."],
  "capabilities": [
    {
      "name": "功能覆盖",
      "support": { "me/app": "partial", "lib/a": "yes", "lib/b": "partial" },
      "note": "A 覆盖了全部需要的接口",
      "evidence": "A 的 README「Features」一节"
    }
  ]
}`

function compactProject(project: ComparisonProjectInput) {
  return {
    repo: project.repo,
    description: project.description,
    language: project.language,
    topics: project.topics.slice(0, 12),
    dependencies: project.dependencies.slice(0, 30),
    readme: project.readme?.slice(0, 2600) ?? null,
    manifestName: project.manifestName,
    manifest: project.manifest?.slice(0, 1400) ?? null,
  }
}

function compactCandidate(candidate: ComparisonCandidateInput) {
  return {
    repo: candidate.repo,
    summary: candidate.summary,
    language: candidate.language,
    topics: candidate.topics.slice(0, 10),
    stars: candidate.stars,
    readme: candidate.readme?.slice(0, 2200) ?? null,
  }
}

export function buildComparisonPrompt(
  project: ComparisonProjectInput,
  candidates: ComparisonCandidateInput[],
): string {
  return `请对比以下候选：\n\n${JSON.stringify(
    { project: compactProject(project), candidates: candidates.map(compactCandidate) },
    null,
    2,
  )}`
}

export function parseComparisonReport(raw: string): ComparisonReport {
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
    if (!Array.isArray((parsed as Record<string, unknown>).candidates)) continue

    const result = comparisonReportSchema.safeParse(parsed)
    if (result.success) return result.data
    const issue = result.error.issues[0]
    lastError = `${issue?.path.join('.') ?? 'unknown'} ${issue?.message ?? ''}`
  }

  if (lastError) throw new Error(`选型对比结构不符合要求：${lastError}`)
  throw new Error('模型返回的 JSON 无法解析（可能被截断或混入了说明文字）')
}

export function groundComparisonReport(
  report: ComparisonReport,
  project: ComparisonProjectInput,
  candidates: ComparisonCandidateInput[],
): ComparisonReport {
  const candidateNames = new Set(candidates.map((candidate) => candidate.repo.toLowerCase()))
  const filtered = report.candidates.filter((candidate) => candidateNames.has(candidate.repo.toLowerCase()))
  if (filtered.length < 2) throw new Error('模型没有返回足够的有效候选对比')

  const recommendation = candidateNames.has(report.recommendation.repo.toLowerCase())
    ? report.recommendation.repo
    : [...filtered].sort((left, right) => right.fitScore - left.fitScore)[0]!.repo

  const allowed = new Map<string, string>([
    [project.repo.toLowerCase(), project.repo],
    ...candidates.map((candidate) => [candidate.repo.toLowerCase(), candidate.repo] as const),
  ])
  const capabilities = report.capabilities
    .map((row) => {
      const support: ComparisonCapability['support'] = {}
      for (const [repo, value] of Object.entries(row.support)) {
        const canonical = allowed.get(repo.toLowerCase())
        if (canonical) support[canonical] = value
      }
      return { ...row, support }
    })
    .filter((row) => Object.keys(row.support).length >= 2)

  return {
    ...report,
    project: project.repo,
    recommendation: { ...report.recommendation, repo: recommendation },
    candidates: filtered,
    capabilities,
  }
}

export async function generateComparisonReport(
  project: ComparisonProjectInput,
  candidates: ComparisonCandidateInput[],
  llm: LlmConfig,
): Promise<ComparisonReport> {
  const prompt = buildComparisonPrompt(project, candidates)
  const messages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    { role: 'user' as const, content: prompt },
  ]

  let raw = await chatCompletion(llm, messages, { temperature: 0.3, maxTokens: 5000, jsonMode: true })
  let report: ComparisonReport | null = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      report = parseComparisonReport(raw)
      break
    } catch (error) {
      console.error(`[comparison] 第 ${attempt + 1} 次输出解析失败：`, error, '\n', raw.slice(0, 1000))
      if (attempt === 1) break
      raw = await chatCompletion(
        llm,
        [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `${prompt}\n\n上一次输出不是合法 JSON。只输出一个合法 JSON 对象，每个候选 2 条优势、2 条弱点。`,
          },
        ],
        { temperature: 0.2, maxTokens: 6000, jsonMode: true },
      )
    }
  }
  if (!report) throw new Error('模型没有返回合法 JSON（已自动重试）')
  return groundComparisonReport(report, project, candidates)
}

export async function saveComparisonReport(
  pool: DbPool,
  userId: number,
  project: string,
  payload: StoredComparisonReport,
): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO comparison_reports (user_id, project_full_name, payload) VALUES ($1, $2, $3) RETURNING id`,
    [userId, project, JSON.stringify(payload)],
  )
  return Number(rows[0]?.id ?? 0)
}

export async function findLatestComparisonReport(
  pool: DbPool,
  userId: number,
  project: string,
): Promise<StoredComparisonReport | null> {
  const { rows } = await pool.query<{ payload: StoredComparisonReport }>(
    `SELECT payload FROM comparison_reports
     WHERE user_id = $1 AND project_full_name = $2
     ORDER BY created_at DESC LIMIT 1`,
    [userId, project],
  )
  return rows[0]?.payload ?? null
}

export function buildComparisonBrief(payload: StoredComparisonReport): string {
  const { report } = payload
  const lines = [
    `# RepoRadar 选型对比任务书 · ${report.project}`,
    '',
    `> 生成时间：${payload.generatedAt}`,
    '',
    report.summary,
    '',
    `## 推荐：${report.recommendation.repo}`,
    '',
    report.recommendation.reason,
    '',
    '## 候选对比',
    '',
  ]

  for (const candidate of report.candidates) {
    lines.push(
      `### ${candidate.repo}`,
      '',
      `- 适配度：${candidate.fitScore}/100`,
      `- 迁移成本：${candidate.migrationEffort}`,
      `- 结论：${candidate.reason}`,
      '- 优势：',
      ...candidate.strengths.map((strength) => `  - ${strength}`),
    )
    if (candidate.weaknesses.length > 0) {
      lines.push('- 弱点：', ...candidate.weaknesses.map((weakness) => `  - ${weakness}`))
    }
    lines.push('')
  }

  if (report.capabilities.length > 0) {
    const repos = [report.project, ...report.candidates.map((candidate) => candidate.repo)]
    lines.push('## 能力差异', '', `| 能力 | ${repos.join(' | ')} |`, `| --- | ${repos.map(() => '---').join(' | ')} |`)
    for (const row of report.capabilities) {
      const cells = repos.map((repo) => row.support[repo] ?? 'unknown')
      lines.push(`| ${row.name} | ${cells.join(' | ')} |`)
      if (row.note) lines.push(`| ${row.name} 说明 | ${row.note} |`)
    }
    lines.push('')
  }

  if (report.nextSteps.length > 0) {
    lines.push('## 验证步骤', '')
    report.nextSteps.forEach((step, index) => lines.push(`${index + 1}. ${step}`))
    lines.push('')
  }

  lines.push(
    '## 给 AI 的要求',
    '',
    '先核对候选的官方文档和当前版本 API，再按验证步骤做一个小范围 spike；不要直接大规模替换。',
    '迁移成本是初步估算，需要结合目标项目的实际调用点重新评估。',
    '',
    '由 RepoRadar 生成。',
  )
  return lines.join('\n')
}

export async function findComparisonReportById(
  pool: DbPool,
  userId: number,
  id: number,
): Promise<StoredComparisonReport | null> {
  const { rows } = await pool.query<{ payload: StoredComparisonReport }>(
    `SELECT payload FROM comparison_reports WHERE user_id = $1 AND id = $2 LIMIT 1`,
    [userId, id],
  )
  return rows[0]?.payload ?? null
}
