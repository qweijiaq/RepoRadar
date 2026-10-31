import { z } from 'zod'
import type { LlmConfig } from './config.js'
import type { IssueEvidence } from './issue.js'
import { chatCompletion } from './llm.js'

export const issueDraftItemSchema = z.object({
  repo: z.string().min(3).max(120),
  name: z.string().min(1).max(80),
  change: z.string().min(4).max(400),
  evidence: z.string().min(4).max(400),
  relevance: z.string().min(4).max(400),
  action: z.enum(['try', 'watch', 'ignore']),
  cost: z.string().max(120).nullable().optional(),
})

export const issueDraftThemeSchema = z.object({
  title: z.string().min(2).max(60),
  judgment: z.string().min(4).max(300),
  items: z.array(issueDraftItemSchema).min(1).max(4),
})

const ignoreEntrySchema = z.object({
  repo: z.string().max(120).nullable().optional(),
  reason: z.string().min(4).max(300),
})

export const issueDraftSchema = z.object({
  title: z.string().min(4).max(120),
  summary: z.array(z.string().min(4).max(200)).min(2).max(5),
  themes: z.array(issueDraftThemeSchema).min(1).max(3),
  ignore: z.array(ignoreEntrySchema).max(5).default([]),
  next: z.array(z.string().min(4).max(120)).max(4).default([]),
})

export type IssueDraft = z.infer<typeof issueDraftSchema>
export type IssueDraftItem = z.infer<typeof issueDraftItemSchema>
export type IssueDraftTheme = z.infer<typeof issueDraftThemeSchema>

export const ACTION_LABELS: Record<IssueDraftItem['action'], string> = {
  try: '值得试',
  watch: '观望',
  ignore: '忽略',
}

const SYSTEM_PROMPT = `你是 RepoRadar 的资深开源编辑，为一位开发者撰写个性化的开源技术周报。
读者很忙，只关心：这周发生了什么变化、和我有什么关系、我要不要动手。

硬性要求：
1. 只输出一个 JSON 对象，不要 Markdown 围栏或任何解释。
2. 所有事实（版本号、日期、star 数、topics）必须来自用户消息里的证据，不得编造。
3. 每个 item 的 repo 必须是证据中出现过的完整仓库名（owner/name）。
4. themes 写 2-3 个；证据不足以支撑时宁可少写，不要凑数。
5. 每个主题 2-4 个 items；每个 item 的动作从 try / watch / ignore 中选。
6. 用简体中文，语气像一位有判断力的编辑，不写空话。
7. ignore 写 3-4 条本周被忽略的项目，说明理由；repo 可填证据中的仓库名，或 null 表示一整类。
8. next 写 2-3 条下期选题。
9. 不要在正文里提到"证据""模型""提示词"。

JSON 结构：
{
  "title": "本期主线，<=50字",
  "summary": ["2-4 条结论，每条一句话"],
  "themes": [
    {
      "title": "主题名",
      "judgment": "一句判断",
      "items": [
        {
          "repo": "owner/name",
          "name": "展示名",
          "change": "这周发生了什么变化",
          "evidence": "引用的版本/日期/star/topics",
          "relevance": "和读者的关系",
          "action": "try|watch|ignore",
          "cost": "试用成本，可省略"
        }
      ]
    }
  ],
  "ignore": [{ "repo": "owner/name 或 null", "reason": "为什么忽略" }],
  "next": ["下期选题"]
}`

interface CompactEvidence {
  user: string
  date: string
  windowDays: number
  profile: IssueEvidence['profile']
  releases: Array<{ repo: string; tag: string | null; date: string | null; isNew: boolean; name: string | null }>
  groups: Array<{
    topic: string
    repos: Array<{
      repo: string
      stars: number
      language: string | null
      topics: string[]
      summary: string
      score: number
      verified: boolean
    }>
  }>
  rising: Array<{ repo: string; growth: number; stars: number }>
}

function compactEvidence(evidence: IssueEvidence): CompactEvidence {
  return {
    user: evidence.userName,
    date: evidence.date.toISOString().slice(0, 10),
    windowDays: evidence.windowDays,
    profile: evidence.profile,
    releases: evidence.releases
      .filter((release) => release.tag)
      .map((release) => ({
        repo: release.repoFullName,
        tag: release.tag,
        date: release.publishedAt ? release.publishedAt.slice(0, 10) : null,
        isNew: release.isNew,
        name: release.name,
      })),
    groups: evidence.groups.map((group) => ({
      topic: group.topic,
      repos: group.repos.map((repo) => ({
        repo: repo.fullName,
        stars: repo.stars,
        language: repo.language,
        topics: repo.topics.slice(0, 6),
        summary: (repo.summary ?? '').slice(0, 180),
        score: repo.score,
        verified: repo.verifyStatus === 'verified',
      })),
    })),
    rising: evidence.rising.map((repo) => ({ repo: repo.fullName, growth: repo.growth, stars: repo.stars })),
  }
}

export function buildNarrativePrompt(evidence: IssueEvidence): string {
  return `以下是本期证据（JSON）。请据此撰写周报，所有事实必须来自这里：\n\n${JSON.stringify(
    compactEvidence(evidence),
    null,
    2,
  )}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 模型偶尔会在个别条目上出错。先丢掉明显不合格的条目再重试校验，
 * 避免一条坏数据毁掉整份草稿。
 */
function relaxDraft(value: unknown): unknown {
  if (!isRecord(value)) return value
  const result: Record<string, unknown> = { ...value }

  if (Array.isArray(value.themes)) {
    result.themes = value.themes
      .map((theme) => {
        if (!isRecord(theme) || !Array.isArray(theme.items)) return null
        const items = theme.items.filter((item) => issueDraftItemSchema.safeParse(item).success)
        if (items.length === 0) return null
        return { ...theme, items }
      })
      .filter((theme) => theme !== null)
  }
  if (Array.isArray(value.ignore)) {
    result.ignore = value.ignore.filter((entry) => ignoreEntrySchema.safeParse(entry).success)
  }
  if (Array.isArray(value.next)) {
    result.next = value.next.filter((item) => typeof item === 'string' && item.length >= 4 && item.length <= 120)
  }
  if (Array.isArray(value.summary)) {
    result.summary = value.summary.filter(
      (item) => typeof item === 'string' && item.length >= 4 && item.length <= 200,
    )
  }
  return result
}

export function parseIssueDraft(raw: string): IssueDraft {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('模型没有返回 JSON 对象')

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    throw new Error('模型返回的 JSON 无法解析')
  }

  const strict = issueDraftSchema.safeParse(parsed)
  if (strict.success) return strict.data

  const relaxed = issueDraftSchema.safeParse(relaxDraft(parsed))
  if (relaxed.success) return relaxed.data

  const issue = relaxed.error.issues[0]
  throw new Error(`模型返回的结构不符合要求：${issue?.path.join('.') ?? 'unknown'} ${issue?.message ?? ''}`)
}

/**
 * 丢弃引用了证据中不存在仓库的条目，避免模型编造项目。
 */
export function groundIssueDraft(draft: IssueDraft, evidence: IssueEvidence): IssueDraft {
  const known = new Set<string>()
  for (const group of evidence.groups) for (const repo of group.repos) known.add(repo.fullName.toLowerCase())
  for (const release of evidence.releases) known.add(release.repoFullName.toLowerCase())
  for (const repo of evidence.rising) known.add(repo.fullName.toLowerCase())

  const themes = draft.themes
    .map((theme) => ({
      ...theme,
      items: theme.items.filter((item) => known.has(item.repo.toLowerCase())),
    }))
    .filter((theme) => theme.items.length > 0)

  const ignore = draft.ignore.filter((entry) => !entry.repo || known.has(entry.repo.toLowerCase()))

  return { ...draft, themes, ignore }
}

export async function generateIssueDraft(evidence: IssueEvidence, llm: LlmConfig): Promise<IssueDraft> {
  const raw = await chatCompletion(
    llm,
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildNarrativePrompt(evidence) },
    ],
    { temperature: 0.5, maxTokens: 4000 },
  )

  const draft = groundIssueDraft(parseIssueDraft(raw), evidence)
  if (draft.themes.length === 0) throw new Error('草稿中没有引用任何证据中的仓库')
  return draft
}
