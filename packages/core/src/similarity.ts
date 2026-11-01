import { cosineSimilarity } from './personalize.js'
import { round } from './utils.js'

export interface SimilarityRepo {
  fullName: string
  topics: string[]
  language: string | null
  embedding?: number[] | null
}

export function repoSimilarity(a: SimilarityRepo, b: SimilarityRepo): number {
  const aTopics = new Set(a.topics)
  const bTopics = new Set(b.topics)
  let intersection = 0
  for (const topic of aTopics) if (bTopics.has(topic)) intersection++
  const union = aTopics.size + bTopics.size - intersection
  const topicScore = union === 0 ? 0 : intersection / union
  const languageScore = a.language && b.language && a.language === b.language ? 1 : 0
  const semantic =
    a.embedding && b.embedding ? Math.max(0, cosineSimilarity(a.embedding, b.embedding)) : null

  return round(
    semantic !== null ? 0.5 * semantic + 0.4 * topicScore + 0.1 * languageScore : 0.8 * topicScore + 0.2 * languageScore,
    4,
  )
}

export function findSimilarRepos<T extends SimilarityRepo>(
  target: SimilarityRepo,
  candidates: T[],
  limit: number,
): Array<{ repo: T; similarity: number }> {
  return candidates
    .filter((repo) => repo.fullName.toLowerCase() !== target.fullName.toLowerCase())
    .map((repo) => ({ repo, similarity: repoSimilarity(target, repo) }))
    .filter((entry) => entry.similarity > 0)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, Math.max(0, limit))
}

const TEXT_STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'project', 'open', 'source',
  'using', 'based', 'into', 'your', 'you', 'are', 'was', 'were', 'has', 'have',
  'will', 'can', 'not', 'but', 'all', 'any', 'our', 'its', 'their', 'they', 'them',
  '一个', '可以', '支持', '以及', '使用', '项目', '这个', '进行', '通过', '提供',
])

function textTokens(text: string): Set<string> {
  const lower = text.toLowerCase()
  const tokens = new Set<string>()
  for (const word of lower.match(/[a-z][a-z0-9+#.-]{2,}/g) ?? []) {
    if (!TEXT_STOP_WORDS.has(word)) tokens.add(word)
  }
  for (const run of lower.match(/[㐀-鿿]{2,}/g) ?? []) {
    for (let index = 0; index < run.length - 1; index++) {
      const bigram = run.slice(index, index + 2)
      if (!TEXT_STOP_WORDS.has(bigram)) tokens.add(bigram)
    }
  }
  return tokens
}

/** 基于描述/README 的轻量文本相似度，无需 embedding。 */
export function textSimilarity(left: string, right: string): number {
  const a = textTokens(left)
  const b = textTokens(right)
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const token of a) if (b.has(token)) intersection++
  return round(intersection / Math.sqrt(a.size * b.size), 4)
}

/** 关键词短语在文本中的覆盖率，用于竞品搜索/排序。 */
export function keywordCoverage(keywords: string[], text: string): number {
  if (keywords.length === 0) return 0
  const haystack = text.toLowerCase()
  const matched = keywords.filter((keyword) => haystack.includes(keyword.toLowerCase())).length
  return round(matched / keywords.length, 4)
}
