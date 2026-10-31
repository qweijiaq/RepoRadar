export type Verdict = 'recommend' | 'neutral' | 'skip'

export interface RepoInput {
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
  verifyStatus: string | null
  verifiedAt: string | null
}
