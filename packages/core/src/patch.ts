import { z } from 'zod'
import type { LlmConfig } from './config.js'
import type { DbPool } from './db.js'
import type { RepoFile } from './github.js'
import { extractJsonObjects } from './integrations.js'
import type { IssueContext, IssuePlan, IssueProjectContext } from './issue-plan.js'
import { chatCompletion } from './llm.js'
import type { PatchValidationResult } from './verify.js'

export const patchSchema = z.object({
  summary: z.string().min(4).max(600),
  files: z.array(z.string().min(1).max(240)).max(20).default([]),
  patch: z.string().min(20).max(160_000),
})

export type GeneratedPatch = z.infer<typeof patchSchema>

const SYSTEM_PROMPT = `你是资深开源维护者，擅长根据 Issue 写出可以直接应用的最小补丁。
用户会给出 Issue、项目上下文，以及相关文件的当前内容。

规则：
- 只修改给定文件，不要新增文件，不要改依赖或锁文件，除非 Issue 明确要求。
- 输出标准 unified diff（git apply 能直接应用），路径使用 a/ 和 b/ 前缀。
- 每个 hunk 的上下文和行号必须与给定文件内容完全一致。
- 保持项目现有风格；只做解决 Issue 所需的最小改动。
- 不确定根因时，仍给出最可能的补丁，并在 summary 里说明假设。
- 不能输出 Markdown 围栏，不能输出解释文字。

只输出一个合法 JSON 对象：
{
  "summary": "改了什么、为什么、有什么假设",
  "files": ["src/changed.ts"],
  "patch": "diff --git a/src/changed.ts b/src/changed.ts\\n--- a/src/changed.ts\\n+++ b/src/changed.ts\\n@@ ... @@\\n..."
}`

function keywordScore(path: string, keywords: string[]): number {
  const lower = path.toLowerCase()
  let score = 0
  for (const keyword of keywords) {
    if (keyword.length >= 3 && lower.includes(keyword)) score += 3
  }
  if (/(^|\/)(test|tests|spec|__tests__)(\/|$)/i.test(path)) score -= 1
  if (/(^|\/)(package\.json|pyproject\.toml|go\.mod|Cargo\.toml)$/i.test(path)) score += 1
  score -= path.split('/').length * 0.2
  return score
}

export function selectPatchFiles(issue: IssueContext, plan: IssuePlan | null, available: string[]): string[] {
  const text = `${issue.title} ${issue.body ?? ''} ${issue.labels.join(' ')}`.toLowerCase()
  const keywords = [...new Set(text.split(/[^a-z0-9_.-]+/).filter((word) => word.length >= 3))].slice(0, 30)
  const preferred = plan?.likelyFiles ?? []
  const candidates = [...new Set([...preferred, ...available])]
  return candidates
    .map((path) => ({ path, score: keywordScore(path, keywords) + (preferred.includes(path) ? 6 : 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((item) => item.path)
}

function compactFiles(files: RepoFile[]): Array<{ path: string; content: string; truncated: boolean }> {
  return files.map((file) => ({
    path: file.path,
    content: file.content.slice(0, 16_000),
    truncated: file.truncated || file.content.length > 16_000,
  }))
}

export function buildPatchPrompt(
  issue: IssueContext,
  project: IssueProjectContext,
  plan: IssuePlan | null,
  files: RepoFile[],
): string {
  return `请为这个 Issue 生成最小修复补丁：\n\n${JSON.stringify(
    {
      repo: issue.repo,
      issue: {
        number: issue.number,
        title: issue.title,
        body: issue.body,
        labels: issue.labels,
        author: issue.author,
        comments: issue.comments.slice(0, 6),
      },
      project: {
        description: project.description,
        language: project.language,
        topics: project.topics.slice(0, 10),
        manifestName: project.manifestName,
        manifest: project.manifest?.slice(0, 2000) ?? null,
      },
      plan: plan
        ? {
            summary: plan.summary,
            steps: plan.steps,
            tests: plan.tests,
            acceptance: plan.acceptance,
          }
        : null,
      files: compactFiles(files),
    },
    null,
    2,
  )}`
}

function cleanPatch(raw: string): string {
  let patch = raw.trim()
  if (patch.startsWith('```')) {
    patch = patch.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim()
  }
  return patch.endsWith('\n') ? patch : `${patch}\n`
}

function patchLooksValid(patch: string): boolean {
  return (
    patch.includes('diff --git ') ||
    (/^--- a\//m.test(patch) && /^\+\+\+ b\//m.test(patch))
  )
}

export function parseGeneratedPatch(raw: string): GeneratedPatch {
  const cleaned = raw.trim()
  let lastError: string | null = null
  for (const candidate of extractJsonObjects(cleaned)) {
    let parsed: unknown
    try {
      parsed = JSON.parse(candidate)
    } catch {
      continue
    }
    if (typeof parsed !== 'object' || parsed === null) continue
    const result = patchSchema.safeParse(parsed)
    if (!result.success) {
      const issue = result.error.issues[0]
      lastError = `${issue?.path.join('.') ?? 'unknown'} ${issue?.message ?? ''}`
      continue
    }
    const patch = cleanPatch(result.data.patch)
    if (!patchLooksValid(patch)) {
      lastError = '模型输出不是 unified diff'
      continue
    }
    return { ...result.data, patch }
  }
  if (lastError) throw new Error(`修复补丁结构不符合要求：${lastError}`)
  throw new Error('模型返回的 JSON 无法解析（可能被截断或混入了说明文字）')
}

export async function generatePatch(
  issue: IssueContext,
  project: IssueProjectContext,
  plan: IssuePlan | null,
  files: RepoFile[],
  llm: LlmConfig,
): Promise<GeneratedPatch> {
  const prompt = buildPatchPrompt(issue, project, plan, files)
  const messages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    { role: 'user' as const, content: prompt },
  ]
  let raw = await chatCompletion(llm, messages, { temperature: 0.2, maxTokens: 6000, jsonMode: true })
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return parseGeneratedPatch(raw)
    } catch (error) {
      console.error(`[patch] 第 ${attempt + 1} 次输出解析失败：`, error, '\n', raw.slice(0, 900))
      if (attempt === 1) break
      raw = await chatCompletion(
        llm,
        [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `${prompt}\n\n上一次输出不是可应用的 unified diff JSON。请严格输出 JSON，patch 字段是 git apply 可用的 diff。`,
          },
        ],
        { temperature: 0.1, maxTokens: 7000, jsonMode: true },
      )
    }
  }
  throw new Error('模型没有返回可应用的补丁（已自动重试）')
}

export interface PatchDraftRecord {
  id: number
  repo: string
  /** issue：修复补丁；integration：接入预演补丁 */
  kind: 'issue' | 'integration'
  issueNumber: number | null
  title: string
  summary: string | null
  patch: string
  files: string[]
  validation: PatchValidationResult | null
  status: 'draft' | 'validated' | 'failed'
  createdAt: string
}

interface PatchRow {
  id: string
  repo_full_name: string
  kind: string
  issue_number: number | null
  title: string
  summary: string | null
  patch: string
  files: unknown
  validation: unknown
  status: 'draft' | 'validated' | 'failed'
  created_at: Date | string
}

function mapPatch(row: PatchRow): PatchDraftRecord {
  return {
    id: Number(row.id),
    repo: row.repo_full_name,
    kind: row.kind === 'integration' ? 'integration' : 'issue',
    issueNumber: row.issue_number,
    title: row.title,
    summary: row.summary,
    patch: row.patch,
    files: Array.isArray(row.files) ? (row.files as string[]) : [],
    validation: (row.validation as PatchValidationResult | null) ?? null,
    status: row.status,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  }
}

export async function savePatchDraft(
  pool: DbPool,
  userId: number,
  input: {
    repo: string
    kind?: 'issue' | 'integration'
    issueNumber: number | null
    title: string
    summary: string | null
    patch: string
    files: string[]
    validation: PatchValidationResult | null
    status: 'draft' | 'validated' | 'failed'
  },
): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO patch_drafts (user_id, repo_full_name, kind, issue_number, title, summary, patch, files, validation, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [
      userId,
      input.repo,
      input.kind ?? 'issue',
      input.issueNumber,
      input.title,
      input.summary,
      input.patch,
      JSON.stringify(input.files),
      input.validation ? JSON.stringify(input.validation) : null,
      input.status,
    ],
  )
  return Number(rows[0]?.id ?? 0)
}

export async function findPatchDraft(
  pool: DbPool,
  userId: number,
  id: number,
): Promise<PatchDraftRecord | null> {
  const { rows } = await pool.query<PatchRow>(
    `SELECT id, repo_full_name, kind, issue_number, title, summary, patch, files, validation, status, created_at
     FROM patch_drafts WHERE user_id = $1 AND id = $2 LIMIT 1`,
    [userId, id],
  )
  return rows[0] ? mapPatch(rows[0]) : null
}

export async function listPatchDrafts(
  pool: DbPool,
  userId: number,
  options: { repo?: string; issueNumber?: number; limit?: number } = {},
): Promise<PatchDraftRecord[]> {
  const clauses = ['user_id = $1']
  const values: unknown[] = [userId]
  if (options.repo) {
    values.push(options.repo)
    clauses.push(`repo_full_name = $${values.length}`)
  }
  if (Number.isFinite(options.issueNumber)) {
    values.push(options.issueNumber)
    clauses.push(`issue_number = $${values.length}`)
  }
  values.push(Math.max(1, Math.min(50, options.limit ?? 10)))
  const { rows } = await pool.query<PatchRow>(
    `SELECT id, repo_full_name, kind, issue_number, title, summary, patch, files, validation, status, created_at
     FROM patch_drafts WHERE ${clauses.join(' AND ')}
     ORDER BY created_at DESC LIMIT $${values.length}`,
    values,
  )
  return rows.map(mapPatch)
}

/** 供用户复制到 GitHub 新建 PR 的描述草稿；不会自动推送或创建 PR。 */
export function buildPullRequestBrief(draft: PatchDraftRecord): string {
  const firstLine = draft.summary?.split('\n').find((line) => line.trim())?.trim() ?? ''
  const title = firstLine
    ? `fix: ${firstLine.replace(/^#+\s*/, '').slice(0, 72)}`
    : `fix: resolve ${draft.repo}${draft.issueNumber ? ` #${draft.issueNumber}` : ''}`
  return [
    `Title: ${title}`,
    '',
    '## 改动说明',
    draft.summary?.trim() || '（在这里补充改动说明）',
    '',
    ...(draft.issueNumber ? [`Closes #${draft.issueNumber}`, ''] : []),
    '## 验证',
    draft.validation
      ? `- 补丁应用：${draft.validation.applies ? '通过' : '失败'}\n- 构建 / 测试：${draft.validation.buildStatus}`
      : '- 尚未验证',
    '',
    '## 说明',
    '本补丁由 RepoRadar 生成，请在提交前人工 review diff，并确认仓库的贡献指南和许可证。',
  ].join('\n')
}

export function buildPatchBrief(draft: PatchDraftRecord): string {
  return [
    `# RepoRadar 修复补丁 · ${draft.repo}${draft.issueNumber ? ` #${draft.issueNumber}` : ''}`,
    '',
    draft.summary ?? '',
    '',
    '```diff',
    draft.patch.trimEnd(),
    '```',
    '',
    `验证状态：${draft.status}`,
    draft.validation
      ? `补丁应用：${draft.validation.applies ? '通过' : '失败'}；构建：${draft.validation.buildStatus}`
      : '',
  ]
    .filter(Boolean)
    .join('\n')
}
