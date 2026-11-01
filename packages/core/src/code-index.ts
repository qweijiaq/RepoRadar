import type { LlmConfig } from './config.js'
import type { DbPool } from './db.js'
import { fetchRepoFile, listRepoTree } from './github.js'
import { embedText } from './llm.js'
import { logEvent } from './logger.js'

export interface CodeChunk {
  path: string
  content: string
  score?: number
}

export interface IndexRepoResult {
  repo: string
  files: number
  chunks: number
  embedded: number
}

/**
 * 按行切块，尽量在换行处断开，相邻块保留一点重叠，避免函数被切断后搜不到。
 */
export function splitCodeChunks(content: string, maxChars = 1500, overlap = 200): string[] {
  const text = content.trim()
  if (!text) return []
  if (text.length <= maxChars) return [text]

  const chunks: string[] = []
  let start = 0
  while (start < text.length) {
    let end = Math.min(text.length, start + maxChars)
    if (end < text.length) {
      const newline = text.lastIndexOf('\n', end)
      if (newline > start + maxChars / 2) end = newline
    }
    chunks.push(text.slice(start, end).trim())
    if (end >= text.length) break
    start = Math.max(end - overlap, start + 1)
  }
  return chunks.filter((chunk) => chunk.length > 0)
}

const SOURCE_EXTENSION = /\.(ts|tsx|js|jsx|mjs|py|go|rs)$/i
const MANIFEST = /(^|\/)(package\.json|pyproject\.toml|go\.mod|Cargo\.toml)$/i
const SKIPPED = /(^|\/)(node_modules|vendor|dist|build|test|tests|__tests__|examples?)\//i

function filePriority(path: string): number {
  if (/^readme(\.|$)/i.test(path)) return 0
  if (MANIFEST.test(path)) return 1
  if (SOURCE_EXTENSION.test(path)) return 2
  if (/\.(md|mdx)$/i.test(path)) return 3
  return 9
}

function pickPaths(paths: string[], maxFiles: number): string[] {
  return paths
    .filter((path) => !SKIPPED.test(path))
    .map((path) => ({ path, priority: filePriority(path) }))
    .filter((item) => item.priority < 9)
    .sort((left, right) => left.priority - right.priority || left.path.length - right.path.length)
    .slice(0, Math.max(1, maxFiles))
    .map((item) => item.path)
}

/**
 * 把仓库的入口文件索引成分块。没有配置 embedding 模型时只存文本，
 * 检索会退化成关键词匹配。
 */
export async function indexRepoCode(
  pool: DbPool,
  repoFullName: string,
  options: { token?: string | null; llm?: LlmConfig | null; maxFiles?: number } = {},
): Promise<IndexRepoResult> {
  const paths = pickPaths(await listRepoTree(repoFullName, options.token ?? undefined), options.maxFiles ?? 6)
  const files = await Promise.all(
    paths.map((path) => fetchRepoFile(repoFullName, path, options.token ?? undefined).catch(() => null)),
  )

  const rows: Array<{ path: string; index: number; content: string; embedding: number[] | null }> = []
  for (const file of files) {
    if (!file) continue
    const chunks = splitCodeChunks(file.content).slice(0, 4)
    for (const [index, chunk] of chunks.entries()) {
      let embedding: number[] | null = null
      if (options.llm?.embeddingModel) {
        embedding = await embedText(options.llm, chunk.slice(0, 4000)).catch(() => null)
      }
      rows.push({ path: file.path, index, content: chunk, embedding })
    }
  }

  await pool.query(`DELETE FROM code_chunks WHERE repo_full_name = $1`, [repoFullName])
  for (const row of rows) {
    await pool.query(
      `INSERT INTO code_chunks (repo_full_name, path, chunk_index, content, embedding)
       VALUES ($1, $2, $3, $4, $5::vector)
       ON CONFLICT (repo_full_name, path, chunk_index) DO UPDATE SET
         content = EXCLUDED.content,
         embedding = EXCLUDED.embedding,
         updated_at = now()`,
      [repoFullName, row.path, row.index, row.content, row.embedding ? JSON.stringify(row.embedding) : null],
    )
  }

  return {
    repo: repoFullName,
    files: new Set(rows.map((row) => row.path)).size,
    chunks: rows.length,
    embedded: rows.filter((row) => row.embedding !== null).length,
  }
}

export async function countCodeChunks(pool: DbPool, repoFullName: string): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM code_chunks WHERE repo_full_name = $1`,
    [repoFullName],
  )
  return Number(rows[0]?.count ?? 0)
}

function keywords(query: string): string[] {
  return [
    ...new Set(
      query
        .split(/[^A-Za-z0-9_\u4e00-\u9fff]+/)
        .map((word) => word.trim())
        .filter((word) => word.length >= 3),
    ),
  ].slice(0, 3)
}

/** 代码证据检索：有 embedding 走向量，否则退化成关键词匹配。 */
export async function searchCodeChunks(
  pool: DbPool,
  repoFullName: string,
  query: string,
  options: { llm?: LlmConfig | null; limit?: number } = {},
): Promise<CodeChunk[]> {
  const limit = Math.max(1, Math.min(10, options.limit ?? 3))

  if (options.llm?.embeddingModel) {
    const embedding = await embedText(options.llm, query.slice(0, 4000)).catch(() => null)
    if (embedding) {
      try {
        const { rows } = await pool.query<{ path: string; content: string; score: number }>(
          `SELECT path, content, 1 - (embedding <=> $2::vector) AS score
           FROM code_chunks
           WHERE repo_full_name = $1 AND embedding IS NOT NULL
           ORDER BY embedding <=> $2::vector
           LIMIT $3`,
          [repoFullName, JSON.stringify(embedding), limit],
        )
        if (rows.length > 0) return rows
      } catch (error) {
        logEvent('warn', 'code_index.search_failed', {
          repo: repoFullName,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  const words = keywords(query)
  if (words.length === 0) return []
  const params: unknown[] = [repoFullName]
  const clauses = words.map((word) => {
    params.push(`%${word}%`)
    return `content ILIKE $${params.length}`
  })
  params.push(limit)
  const { rows } = await pool.query<{ path: string; content: string }>(
    `SELECT path, content FROM code_chunks
     WHERE repo_full_name = $1 AND (${clauses.join(' OR ')})
     ORDER BY updated_at DESC
     LIMIT $${params.length}`,
    params,
  )
  return rows
}
