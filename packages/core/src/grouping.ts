import type { TasteProfile } from './personalize.js'

export interface TopicGroup<T> {
  topic: string
  repos: T[]
}

/**
 * 按「画像里权重最高的 topic」把仓库分组，保留完整对象，供 feed 使用。
 */
export function groupByProfileTopic<T extends { topics: string[]; score: number }>(
  repos: T[],
  profile: TasteProfile | null,
  options: { maxGroups?: number; perGroup?: number } = {},
): TopicGroup<T>[] {
  const weights = profile?.topicWeights ?? {}
  const buckets = new Map<string, T[]>()

  for (const repo of repos) {
    let primary: string | null = null
    let primaryWeight = 0
    for (const topic of repo.topics) {
      const weight = weights[topic] ?? 0
      if (weight > primaryWeight) {
        primary = topic
        primaryWeight = weight
      }
    }
    const topic = primary ?? repo.topics[0] ?? '其他'
    const bucket = buckets.get(topic) ?? []
    bucket.push(repo)
    buckets.set(topic, bucket)
  }

  const groupScore = (group: TopicGroup<T>): number => group.repos.reduce((sum, repo) => sum + repo.score, 0)

  return [...buckets.entries()]
    .map(([topic, items]) => ({
      topic,
      repos: items.sort((a, b) => b.score - a.score).slice(0, options.perGroup ?? 10),
    }))
    .sort((a, b) => groupScore(b) - groupScore(a))
    .slice(0, options.maxGroups ?? 4)
}
