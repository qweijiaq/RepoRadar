/** 适合外部贡献者上手的 issue 标签。 */
const FRIENDLY_LABEL_PATTERN =
  /good first issue|help wanted|contributions welcome|beginner friendly|easy/i

export interface ContributionIssueLike {
  labels: string[]
}

export function isFriendlyIssue(issue: ContributionIssueLike): boolean {
  return issue.labels.some((label) => FRIENDLY_LABEL_PATTERN.test(label))
}

/**
 * 按相似度排序并去掉重复仓库，取前 N 个作为贡献候选。
 */
export function rankContributionTargets<T extends { fullName: string }>(
  entries: Array<{ repo: T; similarity: number; project: string }>,
  limit = 8,
): Array<{ repo: T; similarity: number; project: string }> {
  const byRepo = new Map<string, { repo: T; similarity: number; project: string }>()
  for (const entry of entries) {
    const key = entry.repo.fullName.toLowerCase()
    const existing = byRepo.get(key)
    if (!existing || entry.similarity > existing.similarity) byRepo.set(key, entry)
  }
  return [...byRepo.values()]
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, Math.max(1, limit))
}
