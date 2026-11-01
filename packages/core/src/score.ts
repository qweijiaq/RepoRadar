import { clamp01, round } from './utils.js'
import { SCORING_VERSION } from './versions.js'

export const SCORE_WEIGHTS = { quality: 0.5, newness: 0.25, momentum: 0.25 } as const

const NEWNESS_WINDOW_DAYS = 90

export function computeNewness(pushedAt: string | null, now = Date.now()): number {
  if (!pushedAt) return 0
  const days = (now - Date.parse(pushedAt)) / 86_400_000
  if (!Number.isFinite(days)) return 0
  return clamp01(1 - days / NEWNESS_WINDOW_DAYS)
}

export function computeMomentum(starsNow: number, starsAgo: number | null): number {
  if (starsAgo === null || starsAgo <= 0) return 0.5
  const growth = (starsNow - starsAgo) / starsAgo
  return clamp01(0.5 + growth * 5)
}

export interface ScoreInput {
  quality: number | null
  newness: number
  momentum: number
}

export interface ScoreBreakdown {
  version: string
  total: number
  components: {
    quality: number
    newness: number
    momentum: number
  }
  contributions: {
    quality: number
    newness: number
    momentum: number
  }
}

export function explainScore(input: ScoreInput): ScoreBreakdown {
  const quality = input.quality ?? 0
  const contributions = {
    quality: SCORE_WEIGHTS.quality * quality,
    newness: SCORE_WEIGHTS.newness * input.newness,
    momentum: SCORE_WEIGHTS.momentum * input.momentum,
  }
  return {
    version: SCORING_VERSION,
    total: round(contributions.quality + contributions.newness + contributions.momentum, 4),
    components: { quality, newness: input.newness, momentum: input.momentum },
    contributions: {
      quality: round(contributions.quality, 4),
      newness: round(contributions.newness, 4),
      momentum: round(contributions.momentum, 4),
    },
  }
}

export function computeScore(input: ScoreInput): number {
  return explainScore(input).total
}

export interface RankableRepo {
  qualityScore: number | null
  pushedAt: string | null
  stars: number
  stars7d: number | null
}

export function rankRepos<T extends RankableRepo>(
  repos: T[],
  now = Date.now(),
): Array<T & { score: number; newness: number; momentum: number }> {
  return repos
    .map((repo) => {
      const newness = computeNewness(repo.pushedAt, now)
      const momentum = computeMomentum(repo.stars, repo.stars7d)
      const score = computeScore({ quality: repo.qualityScore, newness, momentum })
      return { ...repo, score, newness, momentum }
    })
    .sort((a, b) => b.score - a.score)
}
