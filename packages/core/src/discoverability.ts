import { z } from 'zod'
import type { LlmConfig } from './config.js'
import type { DbPool } from './db.js'
import { extractJsonObjects } from './integrations.js'
import { chatCompletion } from './llm.js'
import { normalizeTopics } from './repo-management.js'

export interface DiscoverabilityInput {
  repo: string
  description: string
  topics: string[]
  readme: string | null
  language: string | null
  stars: number
  forks: number
  openIssues: number
  homepage: string | null
  license: string | null
  pushedAt: string | null
}

export const discoverabilityDimensionSchema = z.object({
  name: z.string().min(2).max(40),
  score: z.number().int().min(0).max(100),
  comment: z.string().min(2).max(160),
})

export const discoverabilityActionSchema = z.object({
  title: z.string().min(3).max(80),
  why: z.string().min(4).max(200),
  how: z.string().min(4).max(240),
  impact: z.enum(['high', 'medium', 'low']).default('medium'),
})

export const discoverabilityReportSchema = z.object({
  score: z.number().int().min(0).max(100),
  summary: z.string().min(4).max(300),
  dimensions: z.array(discoverabilityDimensionSchema).min(3).max(6),
  strengths: z.array(z.string().min(2).max(160)).max(5).default([]),
  problems: z.array(z.string().min(2).max(160)).max(6).default([]),
  suggestedDescription: z.string().min(8).max(300),
  suggestedTopics: z.array(z.string().max(50)).max(12).default([]),
  readmeSuggestions: z.array(z.string().min(2).max(200)).max(6).default([]),
  actions: z.array(discoverabilityActionSchema).max(6).default([]),
})

export type DiscoverabilityReport = z.infer<typeof discoverabilityReportSchema>
export type DiscoverabilityAction = z.infer<typeof discoverabilityActionSchema>

export interface StoredDiscoverabilityReport {
  id?: number
  report: DiscoverabilityReport
  repo: string
  generatedAt: string
  model?: string | null
  providerId?: string | null
  appliedAt?: string | null
}

export interface DiscoverabilityHistoryPoint {
  id: number
  score: number
  generatedAt: string
  appliedAt: string | null
}

const SYSTEM_PROMPT = `你是开源项目的增长顾问。目标不是夸大宣传，而是让真正需要这个项目的人能在 GitHub 上找到它、看懂它、愿意试用。
用户会给出仓库的描述、topics、README 和基础数据。请做一次「可发现性」体检。

评估维度（给 0-100 分）：
- 定位清晰度：一句话能否说清为谁解决什么问题。
- 搜索关键词：名称、描述、topics 是否覆盖用户会搜索的词。
- README 首屏：前 10 行是否能让人快速理解价值和上手方式。
- 差异化：与同类项目相比的可信理由。
- 信任信号：安装/示例/截图/许可证/维护活跃度。

建议要具体、可执行，不要空话。suggestedDescription 控制在 160 字以内，包含核心关键词，但不要堆砌。suggestedTopics 只使用 GitHub 允许的小写英文、数字和连字符，最多 10 个，覆盖问题域、技术栈和使用场景。README 建议聚焦首屏结构和缺失内容，不要重写整篇。

只输出一个合法 JSON 对象，不要 Markdown 围栏或解释：
{
  "score": 0-100,
  "summary": "整体判断",
  "dimensions": [{ "name": "定位清晰度", "score": 0-100, "comment": "..." }],
  "strengths": ["..."],
  "problems": ["..."],
  "suggestedDescription": "...",
  "suggestedTopics": ["..."],
  "readmeSuggestions": ["..."],
  "actions": [{ "title": "...", "why": "...", "how": "...", "impact": "high|medium|low" }]
}`

function compact(input: DiscoverabilityInput) {
  return {
    repo: input.repo,
    description: input.description,
    topics: input.topics,
    language: input.language,
    stars: input.stars,
    forks: input.forks,
    openIssues: input.openIssues,
    homepage: input.homepage,
    license: input.license,
    pushedAt: input.pushedAt,
    readme: input.readme?.slice(0, 8000) ?? null,
  }
}

export function buildDiscoverabilityPrompt(input: DiscoverabilityInput): string {
  return `请分析这个仓库的可发现性：\n\n${JSON.stringify(compact(input), null, 2)}`
}

function cleanReport(report: DiscoverabilityReport): DiscoverabilityReport {
  return {
    ...report,
    suggestedTopics: normalizeTopics(report.suggestedTopics),
    suggestedDescription: report.suggestedDescription.trim().slice(0, 300),
  }
}

export function parseDiscoverabilityReport(raw: string): DiscoverabilityReport {
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
    if (!Array.isArray((parsed as Record<string, unknown>).dimensions)) continue

    const result = discoverabilityReportSchema.safeParse(parsed)
    if (result.success) return cleanReport(result.data)
    const issue = result.error.issues[0]
    lastError = `${issue?.path.join('.') ?? 'unknown'} ${issue?.message ?? ''}`
  }

  if (lastError) throw new Error(`曝光优化报告结构不符合要求：${lastError}`)
  throw new Error('模型返回的 JSON 无法解析（可能被截断或混入了说明文字）')
}

export async function generateDiscoverabilityReport(
  input: DiscoverabilityInput,
  llm: LlmConfig,
): Promise<DiscoverabilityReport> {
  const prompt = buildDiscoverabilityPrompt(input)
  const messages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    { role: 'user' as const, content: prompt },
  ]

  let raw = await chatCompletion(llm, messages, { temperature: 0.4, maxTokens: 4000, jsonMode: true })
  try {
    return parseDiscoverabilityReport(raw)
  } catch (error) {
    console.error('[discoverability] 第 1 次输出解析失败：', error, '\n', raw.slice(0, 1000))
    raw = await chatCompletion(
      llm,
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `${prompt}\n\n上一次输出不是合法 JSON。请只输出一个合法 JSON 对象，内容精简。` },
      ],
      { temperature: 0.2, maxTokens: 5000, jsonMode: true },
    )
    return parseDiscoverabilityReport(raw)
  }
}

export async function saveDiscoverabilityReport(
  pool: DbPool,
  userId: number,
  payload: StoredDiscoverabilityReport,
): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO discoverability_reports (user_id, repo_full_name, payload) VALUES ($1, $2, $3) RETURNING id`,
    [userId, payload.repo, JSON.stringify(payload)],
  )
  return Number(rows[0]?.id ?? 0)
}

export async function markDiscoverabilityApplied(
  pool: DbPool,
  userId: number,
  repo: string,
  reportId: number | null,
): Promise<void> {
  const appliedAt = new Date().toISOString()
  if (reportId && reportId > 0) {
    await pool.query(
      `UPDATE discoverability_reports
       SET payload = payload || jsonb_build_object('appliedAt', $4::text)
       WHERE user_id = $1 AND repo_full_name = $2 AND id = $3`,
      [userId, repo, reportId, appliedAt],
    )
    return
  }
  await pool.query(
    `UPDATE discoverability_reports
     SET payload = payload || jsonb_build_object('appliedAt', $3::text)
     WHERE id = (
       SELECT id FROM discoverability_reports
       WHERE user_id = $1 AND repo_full_name = $2
       ORDER BY created_at DESC LIMIT 1
     )`,
    [userId, repo, appliedAt],
  )
}

export async function listDiscoverabilityHistory(
  pool: DbPool,
  userId: number,
  repo: string,
  limit = 12,
): Promise<DiscoverabilityHistoryPoint[]> {
  const { rows } = await pool.query<{
    id: string
    payload: Pick<StoredDiscoverabilityReport, 'report' | 'generatedAt' | 'appliedAt'>
  }>(
    `SELECT id, payload FROM discoverability_reports
     WHERE user_id = $1 AND repo_full_name = $2
     ORDER BY created_at DESC LIMIT $3`,
    [userId, repo, Math.max(1, Math.min(50, limit))],
  )
  return rows
    .map((row) => ({
      id: Number(row.id),
      score: Number(row.payload?.report?.score ?? 0),
      generatedAt: row.payload?.generatedAt ?? '',
      appliedAt: row.payload?.appliedAt ?? null,
    }))
    .reverse()
}

export async function findLatestDiscoverabilityReport(
  pool: DbPool,
  userId: number,
  repo: string,
): Promise<StoredDiscoverabilityReport | null> {
  const { rows } = await pool.query<{ id: string; payload: StoredDiscoverabilityReport }>(
    `SELECT id, payload FROM discoverability_reports
     WHERE user_id = $1 AND repo_full_name = $2
     ORDER BY created_at DESC LIMIT 1`,
    [userId, repo],
  )
  const row = rows[0]
  return row ? { ...row.payload, id: Number(row.id) } : null
}

export function buildDiscoverabilityBrief(
  payload: StoredDiscoverabilityReport,
  options: { skipApplied?: boolean } = {},
): string {
  const { report } = payload
  const lines = [
    `# RepoRadar 曝光优化任务书 · ${payload.repo}`,
    '',
    `> 生成时间：${payload.generatedAt}`,
    '',
    `## 现状评分：${report.score}/100`,
    '',
    report.summary,
    '',
    '## 维度',
    '',
  ]
  for (const dimension of report.dimensions) {
    lines.push(`- **${dimension.name}**：${dimension.score}/100 — ${dimension.comment}`)
  }
  if (report.problems.length > 0) {
    lines.push('', '## 主要问题', '')
    for (const problem of report.problems) lines.push(`- ${problem}`)
  }
  if (options.skipApplied && payload.appliedAt) {
    lines.push(
      '',
      '## 已应用内容',
      '',
      `描述和 Topics 已于 ${payload.appliedAt} 应用到 GitHub，本任务书不再重复这两项；下面的 README 和执行动作仍需处理。`,
    )
  } else {
    lines.push('', '## 建议的新描述', '', '```text', report.suggestedDescription, '```')
    if (report.suggestedTopics.length > 0) {
      lines.push('', `## 建议 Topics`, '', report.suggestedTopics.map((topic) => `\`${topic}\``).join(' '))
    }
  }
  if (report.readmeSuggestions.length > 0) {
    lines.push('', '## README 首屏建议', '')
    for (const suggestion of report.readmeSuggestions) lines.push(`- ${suggestion}`)
  }
  if (report.actions.length > 0) {
    lines.push('', '## 执行动作', '')
    for (const action of report.actions) {
      lines.push(`### ${action.title}`, '', `- 为什么：${action.why}`, `- 怎么做：${action.how}`, `- 影响：${action.impact}`)
    }
  }
  lines.push(
    '',
    '## 给 AI 的要求',
    '',
    '只修改这个仓库的元数据和 README，不要夸大或编造功能；先核对 README 中的真实能力，再产出修改。',
    '未经确认不要提交、发布或修改仓库设置。',
    '',
    '由 RepoRadar 生成。',
  )
  return lines.join('\n')
}

export async function findDiscoverabilityReportById(
  pool: DbPool,
  userId: number,
  id: number,
): Promise<StoredDiscoverabilityReport | null> {
  const { rows } = await pool.query<{ payload: StoredDiscoverabilityReport }>(
    `SELECT payload FROM discoverability_reports WHERE user_id = $1 AND id = $2 LIMIT 1`,
    [userId, id],
  )
  const payload = rows[0]?.payload
  return payload ? { ...payload, id } : null
}
