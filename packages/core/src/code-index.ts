import type { LlmConfig } from './config.js'
import type { DbPool } from './db.js'
import { fetchRepoFile, listRepoTree } from './github.js'
import { embedText } from './llm.js'
import { logEvent } from './logger.js'

export interface CodeChunk {
  path: string
  symbol: string | null
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

/** 从 package.json 的 main/module/exports/bin 里提取入口文件路径。 */
export function entryPointsFromManifest(manifest: string | null): string[] {
  if (!manifest) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(manifest)
  } catch {
    return []
  }
  if (!parsed || typeof parsed !== 'object') return []

  const paths = new Set<string>()
  const add = (value: unknown): void => {
    if (typeof value === 'string') {
      const cleaned = value.replace(/^\.\//, '').trim()
      if (cleaned && !cleaned.includes('*') && !/^https?:/i.test(cleaned)) paths.add(cleaned)
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) add(item)
      return
    }
    if (value && typeof value === 'object') {
      for (const item of Object.values(value)) add(item)
    }
  }

  const pkg = parsed as Record<string, unknown>
  for (const key of ['main', 'module', 'browser', 'types', 'typings', 'exports', 'bin']) {
    add(pkg[key])
  }
  return [...paths].slice(0, 12)
}


interface SymbolPart {
  symbol: string | null
  content: string
}

const SYMBOL_PATTERNS = [
  /(?:^|\n)[ \t]*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z0-9_$]+)/g,
  /(?:^|\n)[ \t]*(?:export\s+)?(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*=>/g,
  /(?:^|\n)[ \t]*(?:export\s+)?(?:default\s+)?class\s+([A-Za-z0-9_$]+)/g,
  /(?:^|\n)[ \t]*(?:export\s+)?interface\s+([A-Za-z0-9_$]+)/g,
  /(?:^|\n)[ \t]*(?:export\s+)?type\s+([A-Za-z0-9_$]+)\s*=/g,
  /(?:^|\n)[ \t]*(?:export\s+)?def\s+([A-Za-z0-9_]+)\s*\(/g,
  /(?:^|\n)[ \t]*func\s+(?:\([^)]*\)\s*)?([A-Za-z0-9_]+)\s*\(/g,
  /(?:^|\n)[ \t]*(?:pub\s+)?fn\s+([A-Za-z0-9_]+)/g,
]

interface SymbolMatch {
  index: number
  name: string
}

function findSymbols(content: string): SymbolMatch[] {
  const matches: SymbolMatch[] = []
  for (const pattern of SYMBOL_PATTERNS) {
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(content))) {
      const name = match[1]
      if (!name) continue
      const index = match.index + (match[0].startsWith('\n') ? 1 : 0)
      matches.push({ index, name })
    }
  }
  return matches
    .sort((left, right) => left.index - right.index)
    .filter((match, index, list) => index === 0 || match.index > list[index - 1]!.index)
}

/**
 * 轻量的函数/类级切块：按导出的符号把文件切开，不依赖 tree-sitter。
 * 找不到符号时退回固定长度切块，保证仍可索引。
 */
export function splitCodeBySymbol(content: string, maxChars = 2000): SymbolPart[] {
  const text = content.trim()
  if (!text) return []
  const symbols = findSymbols(text)
  if (symbols.length === 0) {
    return splitCodeChunks(text, maxChars, 200).map((chunk) => ({ symbol: null, content: chunk }))
  }

  const parts: SymbolPart[] = []
  const preamble = text.slice(0, symbols[0]!.index).trim()
  if (preamble.length > 0) parts.push({ symbol: null, content: preamble.slice(0, maxChars) })

  for (let index = 0; index < symbols.length; index++) {
    const start = symbols[index]!.index
    const end = symbols[index + 1]?.index ?? text.length
    const body = text.slice(start, end).trim()
    if (!body) continue
    for (const chunk of splitCodeChunks(body, maxChars, 200)) {
      parts.push({ symbol: symbols[index]!.name, content: chunk })
    }
  }
  return parts
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

function pickPaths(paths: string[], maxFiles: number, preferred: string[] = []): string[] {
  const preferredLower = preferred.map((path) => path.toLowerCase())
  const isPreferred = (path: string): boolean => {
    const lower = path.toLowerCase()
    return preferredLower.some(
      (entry) => lower === entry || lower.startsWith(`${entry}.`) || entry.startsWith(`${lower}.`),
    )
  }

  return paths
    .filter((path) => !SKIPPED.test(path))
    .map((path) => ({ path, priority: isPreferred(path) ? -1 : filePriority(path) }))
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
  const tree = await listRepoTree(repoFullName, options.token ?? undefined)
  const manifestPath = tree.find((path) => /(^|\/)package\.json$/i.test(path)) ?? null
  const manifest = manifestPath
    ? await fetchRepoFile(repoFullName, manifestPath, options.token ?? undefined).catch(() => null)
    : null
  const preferred = entryPointsFromManifest(manifest?.content ?? null)
  const paths = pickPaths(tree, options.maxFiles ?? 8, preferred)
  const files = await Promise.all(
    paths.map((path) => fetchRepoFile(repoFullName, path, options.token ?? undefined).catch(() => null)),
  )

  const rows: Array<{
    path: string
    index: number
    symbol: string | null
    content: string
    embedding: number[] | null
  }> = []
  for (const file of files) {
    if (!file) continue
    const parts = splitCodeBySymbol(file.content).slice(0, 8)
    for (const [index, part] of parts.entries()) {
      let embedding: number[] | null = null
      if (options.llm?.embeddingModel) {
        const label = part.symbol ? `${file.path}#${part.symbol}\n` : ''
        embedding = await embedText(options.llm, `${label}${part.content}`.slice(0, 4000)).catch(() => null)
      }
      rows.push({
        path: file.path,
        index,
        symbol: part.symbol,
        content: part.content,
        embedding,
      })
    }
  }

  await pool.query(`DELETE FROM code_chunks WHERE repo_full_name = $1`, [repoFullName])
  for (const row of rows) {
    await pool.query(
      `INSERT INTO code_chunks (repo_full_name, path, chunk_index, symbol, content, embedding)
       VALUES ($1, $2, $3, $4, $5, $6::vector)
       ON CONFLICT (repo_full_name, path, chunk_index) DO UPDATE SET
         symbol = EXCLUDED.symbol,
         content = EXCLUDED.content,
         embedding = EXCLUDED.embedding,
         updated_at = now()`,
      [
        repoFullName,
        row.path,
        row.index,
        row.symbol,
        row.content,
        row.embedding ? JSON.stringify(row.embedding) : null,
      ],
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
        const { rows } = await pool.query<{
          path: string
          symbol: string | null
          content: string
          score: number
        }>(
          `SELECT path, symbol, content, 1 - (embedding <=> $2::vector) AS score
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
    return `(content ILIKE $${params.length} OR symbol ILIKE $${params.length})`
  })
  params.push(limit)
  const { rows } = await pool.query<{ path: string; symbol: string | null; content: string }>(
    `SELECT path, symbol, content FROM code_chunks
     WHERE repo_full_name = $1 AND (${clauses.join(' OR ')})
     ORDER BY updated_at DESC
     LIMIT $${params.length}`,
    params,
  )
  return rows
}
