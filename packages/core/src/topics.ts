import type { LlmConfig } from './config.js'
import type { DbPool } from './db.js'
import { extractJsonObjects } from './integrations.js'
import { chatCompletion } from './llm.js'

const TOPIC_PATTERN = /^[a-z0-9][a-z0-9-]{1,23}$/

/** 清洗模型输出的标签：小写、连字符、去重、最长 24 字符。 */
export function normalizeTopicTags(tags: string[]): string[] {
  const result: string[] = []
  for (const tag of tags) {
    const normalized = tag
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24)
    if (!TOPIC_PATTERN.test(normalized)) continue
    if (!result.includes(normalized)) result.push(normalized)
  }
  return result.slice(0, 6)
}

export function parseInferredTopics(raw: string): string[] {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim()
  for (const candidate of extractJsonObjects(cleaned)) {
    let parsed: unknown
    try {
      parsed = JSON.parse(candidate)
    } catch {
      continue
    }
    const value = (parsed as { topics?: unknown } | null)?.topics
    if (!Array.isArray(value)) continue
    const topics = normalizeTopicTags(value.filter((item): item is string => typeof item === 'string'))
    if (topics.length >= 2) return topics
  }
  throw new Error('模型返回的主题无法解析（至少需要 2 个合法标签）')
}

export interface InferTopicsInput {
  repo: string
  summary: string | null
  description: string | null
  language: string | null
  existingTopics: string[]
  readme: string | null
}

const PROMPT = `你是开源仓库标注助手。根据 README、摘要和语言，给仓库打 3-5 个 GitHub topic 风格的标签。
规则：
- 只输出小写英文和连字符，例如 cli、schema-validation、llm-agents。
- 不要重复给定已有的 topic。
- 不要用过于空泛的词（library、tool、framework），除非没有更具体的。
- 标签要能帮助别人搜索到这个仓库。
只输出 JSON：{"topics":["...","..."]}`

export async function inferRepoTopics(input: InferTopicsInput, llm: LlmConfig): Promise<string[]> {
  const prompt = JSON.stringify(
    {
      repo: input.repo,
      language: input.language,
      summary: input.summary,
      description: input.description,
      existing_topics: input.existingTopics,
      readme: input.readme?.slice(0, 5000) ?? null,
    },
    null,
    2,
  )
  let raw = await chatCompletion(
    llm,
    [
      { role: 'system', content: PROMPT },
      { role: 'user', content: prompt },
    ],
    { temperature: 0.3, maxTokens: 400, jsonMode: true },
  )
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return parseInferredTopics(raw)
    } catch (error) {
      console.error(`[topics] 第 ${attempt + 1} 次解析失败：`, error, '\n', raw.slice(0, 400))
      if (attempt === 1) break
      raw = await chatCompletion(
        llm,
        [
          { role: 'system', content: PROMPT },
          { role: 'user', content: `${prompt}\n\n上一次输出不合法。请只输出 JSON，topics 里放 3-5 个小写英文标签。` },
        ],
        { temperature: 0.1, maxTokens: 400, jsonMode: true },
      )
    }
  }
  throw new Error('模型没有返回可用的主题标签（已自动重试）')
}

export async function saveInferredTopics(
  pool: DbPool,
  repoFullName: string,
  topics: string[],
): Promise<void> {
  await pool.query(`UPDATE repos SET inferred_topics = $2, updated_at = now() WHERE full_name = $1`, [
    repoFullName,
    normalizeTopicTags(topics),
  ])
}

export async function listReposNeedingTopics(
  pool: DbPool,
  limit = 20,
): Promise<Array<{ fullName: string; summary: string | null; description: string | null; language: string | null }>> {
  const { rows } = await pool.query<{
    full_name: string
    summary: string | null
    description: string | null
    language: string | null
  }>(
    `SELECT full_name, summary, description, language
     FROM repos
     WHERE enriched_at IS NOT NULL
       AND (topics IS NULL OR array_length(topics, 1) IS NULL)
       AND (inferred_topics IS NULL OR array_length(inferred_topics, 1) IS NULL)
     ORDER BY stars DESC
     LIMIT $1`,
    [Math.max(1, limit)],
  )
  return rows.map((row) => ({
    fullName: row.full_name,
    summary: row.summary,
    description: row.description,
    language: row.language,
  }))
}
