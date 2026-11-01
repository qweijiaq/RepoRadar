import type { FeedbackKind, FeedbackSignal } from './feedback.js'
import { explainScore, computeMomentum, computeNewness, type ScoreBreakdown } from './score.js'
import { SCORING_VERSION } from './versions.js'
import { computeSubscriptionBonus, type Subscription } from './subscriptions.js'
import type { EnrichedRepoRecord } from './types.js'
import { clamp01, round } from './utils.js'

export interface TasteProfile {
  topicWeights: Record<string, number>
  languageWeights: Record<string, number>
  embedding: number[] | null
  excludedTopics: string[]
  excludedLanguages: string[]
  starredCount: number
  sourceCounts?: { stars: number; owned: number; events: number }
  updatedAt: string
}

export interface StarredSignal {
  topics: string[]
  language: string | null
  embedding: number[] | null
  /** 行为权重：最近的 star、自己维护的仓库、近期事件权重更高 */
  weight?: number
  source?: 'star' | 'owned' | 'event'
}

export interface BuildProfileOptions {
  starred: StarredSignal[]
  excludedTopics?: string[]
  excludedLanguages?: string[]
  now?: Date
}

function normalise(counts: Map<string, number>): Record<string, number> {
  const entries = [...counts.entries()]
  if (entries.length === 0) return {}
  const max = Math.max(...entries.map(([, count]) => count))
  const result: Record<string, number> = {}
  for (const [key, count] of entries) result[key] = round(count / max, 4)
  return result
}

function averageVector(vectors: number[][]): number[] | null {
  if (vectors.length === 0) return null
  const dimension = Math.min(...vectors.map((vector) => vector.length))
  if (dimension === 0) return null
  const sum = new Array<number>(dimension).fill(0)
  for (const vector of vectors) {
    for (let index = 0; index < dimension; index++) {
      sum[index] = (sum[index] ?? 0) + (vector[index] ?? 0)
    }
  }
  return sum.map((value) => value / vectors.length)
}

export function buildTasteProfile(options: BuildProfileOptions): TasteProfile {
  const topicCounts = new Map<string, number>()
  const languageCounts = new Map<string, number>()
  const embeddings: number[][] = []
  const sourceCounts = { stars: 0, owned: 0, events: 0 }

  for (const repo of options.starred) {
    const weight = repo.weight ?? 1
    if (repo.source === 'star') sourceCounts.stars++
    else if (repo.source === 'owned') sourceCounts.owned++
    else if (repo.source === 'event') sourceCounts.events++

    for (const topic of repo.topics) topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + weight)
    if (repo.language) languageCounts.set(repo.language, (languageCounts.get(repo.language) ?? 0) + weight)
    if (repo.embedding && repo.embedding.length > 0) embeddings.push(repo.embedding)
  }

  return {
    topicWeights: normalise(topicCounts),
    languageWeights: normalise(languageCounts),
    embedding: averageVector(embeddings),
    excludedTopics: options.excludedTopics ?? [],
    excludedLanguages: options.excludedLanguages ?? [],
    starredCount: options.starred.length,
    sourceCounts,
    updatedAt: (options.now ?? new Date()).toISOString(),
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const dimension = Math.min(a.length, b.length)
  if (dimension === 0) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let index = 0; index < dimension; index++) {
    const x = a[index] ?? 0
    const y = b[index] ?? 0
    dot += x * y
    normA += x * x
    normB += y * y
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

export function topicAffinity(profile: TasteProfile, topics: string[]): number {
  if (topics.length === 0) return 0
  let sum = 0
  for (const topic of topics) sum += profile.topicWeights[topic] ?? 0
  return clamp01(sum / topics.length)
}

export function isExcluded(profile: TasteProfile, repo: { topics: string[]; language: string | null }): boolean {
  if (repo.topics.some((topic) => profile.excludedTopics.includes(topic))) return true
  if (repo.language && profile.excludedLanguages.includes(repo.language)) return true
  return false
}

export interface FeedbackContext {
  hidden: Set<string>
  saved: Set<string>
  topicAdjustments: Record<string, number>
}

/**
 * 把收藏/不感兴趣聚合成每个 topic 的微调值，范围约 [-0.15, 0.15]。
 */
export function computeTopicAdjustments(signals: FeedbackSignal[]): Record<string, number> {
  const scores = new Map<string, number>()
  for (const signal of signals) {
    const delta = signal.kind === 'save' ? 1 : -1
    for (const topic of signal.topics) scores.set(topic, (scores.get(topic) ?? 0) + delta)
  }

  const adjustments: Record<string, number> = {}
  for (const [topic, score] of scores) {
    const bounded = Math.max(-3, Math.min(3, score))
    adjustments[topic] = round((bounded / 3) * 0.15, 4)
  }
  return adjustments
}

export function buildFeedbackContext(
  feedback: Map<string, FeedbackKind>,
  signals: FeedbackSignal[],
): FeedbackContext {
  const hidden = new Set<string>()
  const saved = new Set<string>()
  for (const [repoFullName, kind] of feedback) {
    if (kind === 'hide') hidden.add(repoFullName)
    else saved.add(repoFullName)
  }
  return { hidden, saved, topicAdjustments: computeTopicAdjustments(signals) }
}

function feedbackAdjustment(context: FeedbackContext, repo: EnrichedRepoRecord): number {
  let adjustment = context.saved.has(repo.fullName) ? 0.08 : 0
  if (repo.topics.length > 0) {
    let sum = 0
    for (const topic of repo.topics) sum += context.topicAdjustments[topic] ?? 0
    adjustment += sum / repo.topics.length
  }
  return round(adjustment, 4)
}

export interface PersonalizedScoreBreakdown {
  version: string
  total: number
  global: ScoreBreakdown
  affinity: {
    semantic: number | null
    topic: number
    language: number
    total: number
    weight: number
    contribution: number
  } | null
  adjustments: {
    feedback: number
    subscription: number
    total: number
  }
  weights: {
    affinity: number
    global: number
  }
}

/**
 * 语义相似度优先用 SQL 预计算的结果；只有在没预计算时才回退到本地余弦，
 * 这样 feed 不需要把每个仓库的 1536 维向量传上来。
 */
function repoSemantic(profile: TasteProfile, repo: EnrichedRepoRecord): number | null {
  if (repo.semanticScore !== undefined) {
    return repo.semanticScore === null ? null : clamp01(repo.semanticScore)
  }
  return profile.embedding && repo.embedding
    ? clamp01(cosineSimilarity(profile.embedding, repo.embedding))
    : null
}

export function explainPersonalizedScore(
  profile: TasteProfile | null,
  repo: EnrichedRepoRecord,
  now = Date.now(),
  feedback: FeedbackContext | null = null,
  subscriptions: Subscription[] = [],
): PersonalizedScoreBreakdown {
  const newness = computeNewness(repo.pushedAt, now)
  const momentum = computeMomentum(repo.stars, repo.stars7d)
  const global = explainScore({ quality: repo.qualityScore, newness, momentum })
  const feedbackScore = feedback ? feedbackAdjustment(feedback, repo) : 0
  const subscriptionScore = computeSubscriptionBonus(repo, subscriptions)
  const adjustments = {
    feedback: round(feedbackScore, 4),
    subscription: round(subscriptionScore, 4),
    total: round(feedbackScore + subscriptionScore, 4),
  }
  const base = {
    version: SCORING_VERSION,
    global,
    adjustments,
  }

  if (feedback?.hidden.has(repo.fullName)) {
    return {
      ...base,
      total: -1,
      affinity: null,
      weights: { affinity: 0, global: 1 },
    }
  }

  const globalTotal = clamp01(global.total + adjustments.total)
  if (!profile || profile.starredCount === 0) {
    return {
      ...base,
      total: globalTotal,
      affinity: null,
      weights: { affinity: 0, global: 1 },
    }
  }

  if (isExcluded(profile, repo)) {
    return {
      ...base,
      total: -1,
      affinity: null,
      weights: { affinity: 0.55, global: 0.45 },
    }
  }

  const semantic = repoSemantic(profile, repo)
  const topic = topicAffinity(profile, repo.topics)
  const language = repo.language ? (profile.languageWeights[repo.language] ?? 0) : 0
  const affinity =
    semantic !== null ? 0.5 * semantic + 0.35 * topic + 0.15 * language : 0.7 * topic + 0.3 * language
  const affinityWeight = 0.55
  const globalWeight = 0.45
  const total = clamp01(
    round(affinityWeight * affinity + globalWeight * global.total + adjustments.total, 4),
  )

  return {
    ...base,
    total,
    affinity: {
      semantic: semantic === null ? null : round(semantic, 4),
      topic: round(topic, 4),
      language: round(language, 4),
      total: round(affinity, 4),
      weight: affinityWeight,
      contribution: round(affinityWeight * affinity, 4),
    },
    weights: { affinity: affinityWeight, global: globalWeight },
  }
}

export function personalizedScore(
  profile: TasteProfile | null,
  repo: EnrichedRepoRecord,
  now = Date.now(),
  feedback: FeedbackContext | null = null,
  subscriptions: Subscription[] = [],
): number {
  return explainPersonalizedScore(profile, repo, now, feedback, subscriptions).total
}

export function rankForUser(
  profile: TasteProfile | null,
  repos: EnrichedRepoRecord[],
  now = Date.now(),
  feedback: FeedbackContext | null = null,
  subscriptions: Subscription[] = [],
): Array<EnrichedRepoRecord & { score: number; scoreBreakdown: PersonalizedScoreBreakdown }> {
  return repos
    .filter((repo) => repo.verdict !== 'skip')
    .map((repo) => {
      const scoreBreakdown = explainPersonalizedScore(profile, repo, now, feedback, subscriptions)
      return { ...repo, score: scoreBreakdown.total, scoreBreakdown }
    })
    .filter((repo) => repo.score >= 0)
    .sort((a, b) => b.score - a.score)
}
