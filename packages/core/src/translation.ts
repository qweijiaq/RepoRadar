import { createHash } from 'node:crypto'
import type { LlmConfig } from './config.js'
import type { DbPool } from './db.js'
import { chatCompletion } from './llm.js'

const CACHE_TTL = 7 * 86_400_000
const CACHE_LIMIT = 800
const cache = new Map<string, { value: string; expires: number }>()

/** 只对看起来是英文的仓库描述触发翻译，避免中文/短文本浪费模型调用。 */
export function isLikelyEnglishDescription(text: string): boolean {
  const value = text.trim()
  if (value.length < 20) return false
  if (/[㐀-鿿]/.test(value)) return false
  const letters = (value.match(/[A-Za-z]/g) ?? []).length
  return letters / value.length >= 0.4
}

/** 翻译缓存的稳定键，落库和进程内缓存共用。 */
export function translationKey(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 32)
}

const cacheKey = translationKey

function readCache(text: string, now: number): string | null {
  const entry = cache.get(cacheKey(text))
  if (!entry || entry.expires <= now) {
    if (entry) cache.delete(cacheKey(text))
    return null
  }
  return entry.value
}

function writeCache(text: string, value: string, now: number): void {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest) cache.delete(oldest)
  }
  cache.set(cacheKey(text), { value, expires: now + CACHE_TTL })
}

function parseTranslations(raw: string): string[] {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim()
  for (const candidate of cleaned.match(/\{[\s\S]*\}/g) ?? []) {
    try {
      const parsed = JSON.parse(candidate) as { translations?: unknown }
      if (!Array.isArray(parsed.translations)) continue
      return parsed.translations.filter((item): item is string => typeof item === 'string')
    } catch {
      // 尝试下一个 JSON 对象
    }
  }
  return []
}

/**
 * 批量把英文仓库描述翻译成简体中文。结果在进程内缓存 7 天。
 * 模型不可用或返回格式异常时返回空表，由页面回退到原文。
 */
export async function translateRepoDescriptions(
  texts: string[],
  llm: LlmConfig | null | undefined,
): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  if (!llm) return result
  const now = Date.now()
  const pending: string[] = []
  for (const text of [...new Set(texts)]) {
    if (!isLikelyEnglishDescription(text)) continue
    const cached = readCache(text, now)
    if (cached) result.set(text, cached)
    else pending.push(text)
  }
  if (pending.length === 0) return result

  const batch = pending.slice(0, 10)
  try {
    const raw = await chatCompletion(
      llm,
      [
        {
          role: 'system',
          content:
            '你是开源项目编辑。把用户给出的英文仓库描述翻译成简体中文：保留产品名、技术名词和命令，不添加原文没有的功能，每条控制在 120 字以内。只输出 JSON：{"translations":["..."]}，数组长度和顺序必须与输入一致。',
        },
        { role: 'user', content: JSON.stringify(batch) },
      ],
      { temperature: 0.2, maxTokens: Math.min(2400, 240 + batch.length * 220), jsonMode: true },
    )
    const translations = parseTranslations(raw)
    if (translations.length !== batch.length) return result
    batch.forEach((text, index) => {
      const translated = translations[index]?.trim()
      if (!translated || !/[\u3400-\u9fff]/.test(translated) || translated === text) return
      writeCache(text, translated, now)
      result.set(text, translated)
    })
  } catch {
    // 翻译失败不影响推荐内容
  }
  return result
}

/**
 * 只读翻译缓存：先看进程内，再查 repo_translations。不会调用模型，
 * 页面渲染可以放心使用。
 */
export async function loadRepoTranslations(
  pool: DbPool,
  texts: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  const now = Date.now()
  const missing: string[] = []
  for (const text of new Set(texts)) {
    if (!isLikelyEnglishDescription(text)) continue
    const cached = readCache(text, now)
    if (cached) result.set(text, cached)
    else missing.push(text)
  }
  if (missing.length === 0) return result

  const byHash = new Map(missing.map((text) => [cacheKey(text), text]))
  const { rows } = await pool.query<{ source_hash: string; translated: string }>(
    `SELECT source_hash, translated FROM repo_translations WHERE source_hash = ANY($1)`,
    [[...byHash.keys()]],
  )
  for (const row of rows) {
    const source = byHash.get(row.source_hash)
    if (!source) continue
    writeCache(source, row.translated, now)
    result.set(source, row.translated)
  }
  return result
}

const inFlight = new Set<string>()

/**
 * 在响应结束后调用：翻译缺失的描述并落库。返回本次写入的条数。
 * 同一段文本只允许一个并发请求去调用模型。
 */
export async function warmRepoTranslations(
  pool: DbPool,
  llm: LlmConfig | null | undefined,
  texts: string[],
): Promise<number> {
  if (!llm) return 0
  const pending = [...new Set(texts)].filter(
    (text) => isLikelyEnglishDescription(text) && !inFlight.has(cacheKey(text)),
  )
  if (pending.length === 0) return 0
  for (const text of pending) inFlight.add(cacheKey(text))
  try {
    const translated = await translateRepoDescriptions(pending.slice(0, 10), llm)
    await saveRepoTranslations(pool, translated)
    return translated.size
  } finally {
    for (const text of pending) inFlight.delete(cacheKey(text))
  }
}

async function saveRepoTranslations(pool: DbPool, translated: Map<string, string>): Promise<void> {
  if (translated.size === 0) return
  const entries = [...translated.entries()]
  await pool.query(
    `INSERT INTO repo_translations (source_hash, source, translated)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[])
     ON CONFLICT (source_hash) DO UPDATE SET
       translated = EXCLUDED.translated, updated_at = now()`,
    [
      entries.map(([source]) => cacheKey(source)),
      entries.map(([source]) => source),
      entries.map(([, value]) => value),
    ],
  )
}
