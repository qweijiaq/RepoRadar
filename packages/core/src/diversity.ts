export interface DiversifiableRepo {
  fullName: string
  topics: string[]
  language: string | null
  score: number
}

export interface DiversityOptions {
  limit: number
  /** 每个 topic 最多出现几次（软约束，候选不足时会放宽） */
  maxPerTopic?: number
  /** 每种语言最多出现几个（软约束） */
  maxPerLanguage?: number
}

/**
 * 对已按分数排好序的列表做多样性约束：
 * 先按配额选取，配额选不满时再按原顺序补足。
 */
export function diversifyRanking<T extends DiversifiableRepo>(items: T[], options: DiversityOptions): T[] {
  const limit = Math.max(0, options.limit)
  if (limit === 0) return []

  const maxPerTopic = options.maxPerTopic ?? 2
  const maxPerLanguage = options.maxPerLanguage ?? Math.max(1, Math.ceil(limit * 0.6))
  const selected: T[] = []
  const selectedNames = new Set<string>()
  const topicCounts = new Map<string, number>()
  const languageCounts = new Map<string, number>()

  const tryAdd = (item: T): boolean => {
    if (selected.length >= limit || selectedNames.has(item.fullName)) return false
    if (item.topics.some((topic) => (topicCounts.get(topic) ?? 0) >= maxPerTopic)) return false
    if (item.language && (languageCounts.get(item.language) ?? 0) >= maxPerLanguage) return false

    selected.push(item)
    selectedNames.add(item.fullName)
    for (const topic of item.topics) topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1)
    if (item.language) languageCounts.set(item.language, (languageCounts.get(item.language) ?? 0) + 1)
    return true
  }

  for (const item of items) {
    if (selected.length >= limit) break
    tryAdd(item)
  }

  if (selected.length < limit) {
    for (const item of items) {
      if (selected.length >= limit) break
      if (selectedNames.has(item.fullName)) continue
      selected.push(item)
      selectedNames.add(item.fullName)
    }
  }

  return selected
}
