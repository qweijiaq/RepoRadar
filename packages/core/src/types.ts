export type Verdict = 'recommend' | 'neutral' | 'skip'

export interface RepoInput {
  /** GitHub 的稳定数字 ID；改名/转移后仍能识别同一个仓库。 */
  githubId?: number | null
  fullName: string
  owner: string
  name: string
  description: string | null
  htmlUrl: string
  homepage: string | null
  language: string | null
  topics: string[]
  stars: number
  forks: number
  openIssues: number
  license: string | null
  archived: boolean
  isFork: boolean
  pushedAt: string | null
  createdAt: string | null
}

export interface RepoRecord extends RepoInput {
  id: number
  /** GitHub 没有 topic 时由 AI 推断的标签；不覆盖 GitHub 原始 topics。 */
  inferredTopics?: string[]
}

export interface EnrichedRepoRecord extends RepoRecord {
  summary: string | null
  problem: string | null
  audience: string | null
  verdict: string | null
  reason: string | null
  qualityScore: number | null
  stars7d: number | null
  embedding: number[] | null
  /** 由 SQL 用 pgvector 预计算的余弦相似度（0–1）；存在时优先于本地 embedding 计算。 */
  semanticScore?: number | null
  verifyStatus: string | null
  verifiedAt: string | null
}
