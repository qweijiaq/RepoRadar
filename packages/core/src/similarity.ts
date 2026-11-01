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
