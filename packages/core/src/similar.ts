import { z } from 'zod'
import type { LlmConfig } from './config.js'
import type { DbPool } from './db.js'
import { chatCompletion } from './llm.js'

export interface SimilarProjectInput {
  repo: string
  description: string
  language: string | null
  topics: string[]
  readme: string | null
  manifestName: string | null
  manifest: string | null
}

export interface SimilarCandidateInput extends SimilarProjectInput {
  similarity: number
  stars: number
}

export const similarCandidateSchema = z.object({
  repo: z.string().min(3).max(120),
  similarity: z.number().int().min(0).max(100),
  overview: z.string().min(4).max(500),
  candidateStrengths: z.array(z.string().min(2).max(180)).min(1).max(5),
  candidateWeaknesses: z.array(z.string().min(2).max(180)).max(5).default([]),
  targetAdvantages: z.array(z.string().min(2).max(180)).max(5).default([]),
  borrowable: z.array(z.string().min(2).max(220)).min(1).max(6),
  risks: z.array(z.string().min(2).max(180)).max(5).default([]),
})

export const similarReportSchema = z.object({
  project: z.string().min(3).max(120),
  summary: z.string().min(4).max(600),
  candidates: z.array(similarCandidateSchema).min(1).max(5),
  nextSteps: z.array(z.string().min(2).max(220)).max(6).default([]),
})

export type SimilarCandidate = z.infer<typeof similarCandidateSchema>
export type SimilarReport = z.infer<typeof similarReportSchema>

export interface StoredSimilarReport {
  id?: number
  report: SimilarReport
  generatedAt: string
  model?: string | null
  providerId?: string | null
  candidateRepos?: string[]
}

const SYSTEM_PROMPT = `你是资深开源项目架构顾问。用户会给出一个自己正在维护的项目，以及几个 GitHub 上找到的相似项目。
任务：逐个对比相似项目，帮助用户判断对方强在哪、自己强在哪、有什么可以直接借鉴。
规则：
- overview 说明对方项目是什么，以及和目标项目的关系。
- candidateStrengths 是对方比目标项目做得更好的地方；candidateWeaknesses 是对方不如目标项目的地方。
- targetAdvantages 是目标项目应该保留的优势，不要为了借鉴而丢掉。
- borrowable 必须具体、可执行，说明可以借鉴什么设计、功能或工程实践；不要泛泛而谈。
- risks 说明直接照搬可能带来的许可证、复杂度、维护成本或产品定位风险。
- similarity 用给定候选的 similarity 字段，不要自己大幅改动。
- 只引用候选列表里的仓库全名，不得编造 API 或功能；信息不足时明确说需要进一步核实。
- 不要输出分析过程、思考过程或 Markdown 围栏，第一个字符必须是 {，最后一个字符必须是 }。

只输出一个合法 JSON 对象：
{
  "project": "owner/name",
  "summary": "整体对比结论",
  "candidates": [
    {
      "repo": "owner/name",
      "similarity": 80,
      "overview": "...",
      "candidateStrengths": ["..."],
      "candidateWeaknesses": ["..."],
      "targetAdvantages": ["..."],
      "borrowable": ["..."],
      "risks": ["..."]
    }
  ],
  "nextSteps": ["..."]
}`

function compactProject(project: SimilarProjectInput) {
  return {
    repo: project.repo,
    description: project.description,
    language: project.language,
    topics: project.topics.slice(0, 12),
    readme: project.readme?.slice(0, 2600) ?? null,
    manifestName: project.manifestName,
    manifest: project.manifest?.slice(0, 1400) ?? null,
  }
}

function compactCandidate(candidate: SimilarCandidateInput) {
  return {
    repo: candidate.repo,
    description: candidate.description,
    language: candidate.language,
    topics: candidate.topics.slice(0, 10),
    stars: candidate.stars,
    similarity: Math.round(candidate.similarity * 100),
    readme: candidate.readme?.slice(0, 2400) ?? null,
    manifestName: candidate.manifestName,
    manifest: candidate.manifest?.slice(0, 1200) ?? null,
  }
}

export function buildSimilarPrompt(project: SimilarProjectInput, candidates: SimilarCandidateInput[]): string {
  return `目标项目：\n${JSON.stringify(compactProject(project), null, 2)}\n\n相似项目候选：\n${JSON.stringify(
    candidates.map(compactCandidate),
    null,
    2,
  )}`
}

export function parseSimilarReport(raw: string): SimilarReport {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim()
  let lastError: string | null = null
  for (const candidate of cleaned.match(/\{[\s\S]*\}/g) ?? []) {
    try {
      const parsed = JSON.parse(candidate) as unknown
      if (typeof parsed !== 'object' || parsed === null) continue
      const projects = (parsed as Record<string, unknown>).candidates
      if (!Array.isArray(projects)) continue
      const result = similarReportSchema.safeParse(parsed)
      if (result.success) return result.data
      lastError = `${result.error.issues[0]?.path.join('.') ?? 'unknown'} ${result.error.issues[0]?.message ?? ''}`
    } catch {
      // 尝试下一个对象
    }
  }
  if (lastError) throw new Error(`相似项目报告结构不符合要求：${lastError}`)
  throw new Error('模型返回的 JSON 无法解析（可能被截断或混入了说明文字）')
}

export function groundSimilarReport(
  report: SimilarReport,
  project: SimilarProjectInput,
  candidates: SimilarCandidateInput[],
): SimilarReport {
  const candidateMap = new Map(candidates.map((candidate) => [candidate.repo.toLowerCase(), candidate]))
  return {
    project: project.repo,
    summary: report.summary,
    nextSteps: report.nextSteps,
    candidates: report.candidates
      .filter((candidate) => candidateMap.has(candidate.repo.toLowerCase()))
      .map((candidate) => {
        const known = candidateMap.get(candidate.repo.toLowerCase())!
        return {
          ...candidate,
          similarity: Math.round(known.similarity * 100),
        }
      }),
  }
}

export async function generateSimilarReport(
  project: SimilarProjectInput,
  candidates: SimilarCandidateInput[],
  llm: LlmConfig,
): Promise<SimilarReport> {
  const prompt = buildSimilarPrompt(project, candidates)
  const messages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    { role: 'user' as const, content: prompt },
  ]
  let raw = await chatCompletion(llm, messages, { temperature: 0.3, maxTokens: 8000, jsonMode: true })
  let report: SimilarReport | null = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      report = parseSimilarReport(raw)
      break
    } catch (error) {
      console.error(`[similar] 第 ${attempt + 1} 次输出解析失败：`, error, '\n', raw.slice(0, 800))
      if (attempt === 1) break
      raw = await chatCompletion(
        llm,
        [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `${prompt}\n\n上一次输出不是合法 JSON。不要解释或输出思考过程，直接输出 {"project":"...","summary":"...","candidates":[...],"nextSteps":[...]}。`,
          },
        ],
        { temperature: 0.15, maxTokens: 8000, jsonMode: true },
      )
    }
  }
  if (!report) throw new Error('模型没有返回合法 JSON（已自动重试）')
  return groundSimilarReport(report, project, candidates)
}

export async function saveSimilarReport(
  pool: DbPool,
  userId: number,
  project: string,
  payload: StoredSimilarReport,
): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO similar_reports (user_id, project_full_name, payload) VALUES ($1, $2, $3) RETURNING id`,
    [userId, project, JSON.stringify(payload)],
  )
  return Number(rows[0]?.id ?? 0)
}

export async function findLatestSimilarReport(
  pool: DbPool,
  userId: number,
  project: string,
): Promise<StoredSimilarReport | null> {
  const { rows } = await pool.query<{ id: string; payload: StoredSimilarReport }>(
    `SELECT id, payload FROM similar_reports
     WHERE user_id = $1 AND project_full_name = $2
     ORDER BY created_at DESC LIMIT 1`,
    [userId, project],
  )
  return rows[0] ? { ...rows[0].payload, id: Number(rows[0].id) } : null
}

export async function findSimilarReportById(
  pool: DbPool,
  userId: number,
  id: number,
): Promise<StoredSimilarReport | null> {
  const { rows } = await pool.query<{ payload: StoredSimilarReport }>(
    `SELECT payload FROM similar_reports WHERE user_id = $1 AND id = $2 LIMIT 1`,
    [userId, id],
  )
  return rows[0] ? { ...rows[0].payload, id } : null
}

export function buildSimilarBrief(payload: StoredSimilarReport): string {
  const { report } = payload
  const lines = [
    `# RepoRadar 相似项目对比 · ${report.project}`,
    '',
    `> 生成时间：${payload.generatedAt}`,
    '',
    report.summary,
    '',
  ]
  for (const candidate of report.candidates) {
    lines.push(
      `## ${candidate.repo}（相似度 ${candidate.similarity}/100）`,
      '',
      candidate.overview,
      '',
      '- 对方更强的地方：',
      ...candidate.candidateStrengths.map((item) => `  - ${item}`),
      ...(candidate.candidateWeaknesses.length > 0
        ? ['- 对方不如目标项目的地方：', ...candidate.candidateWeaknesses.map((item) => `  - ${item}`)]
        : []),
      ...(candidate.targetAdvantages.length > 0
        ? ['- 目标项目应保留的优势：', ...candidate.targetAdvantages.map((item) => `  - ${item}`)]
        : []),
      '- 可以借鉴：',
      ...candidate.borrowable.map((item) => `  - ${item}`),
      ...(candidate.risks.length > 0
        ? ['- 风险：', ...candidate.risks.map((item) => `  - ${item}`)]
        : []),
      '',
    )
  }
  if (report.nextSteps.length > 0) {
    lines.push('## 建议下一步', '', ...report.nextSteps.map((step, index) => `${index + 1}. ${step}`), '')
  }
  lines.push('由 RepoRadar 生成。对比基于公开 README 和元数据，采纳前请核实。')
  return lines.join('\n').trimEnd()
}
