import { describe, expect, it } from 'vitest'
import {
  groupEvidence,
  renderIssueMarkdown,
  summarizeProfile,
  type IssueEvidence,
} from '../src/issue.js'
import { buildTasteProfile } from '../src/personalize.js'
import type { EnrichedRepoRecord } from '../src/types.js'

function makeRepo(overrides: Partial<EnrichedRepoRecord & { score: number }> = {}): EnrichedRepoRecord & { score: number } {
  return {
    id: 1,
    fullName: 'acme/tool',
    owner: 'acme',
    name: 'tool',
    description: null,
    htmlUrl: 'https://github.com/acme/tool',
    homepage: null,
    language: 'TypeScript',
    topics: ['cli'],
    stars: 100,
    forks: 1,
    openIssues: 0,
    license: 'MIT',
    archived: false,
    isFork: false,
    pushedAt: '2026-10-20T00:00:00Z',
    createdAt: '2024-01-01T00:00:00Z',
    summary: '一个 CLI 工具',
    problem: null,
    audience: null,
    verdict: 'recommend',
    reason: '近期活跃',
    qualityScore: 0.8,
    stars7d: null,
    embedding: null,
    verifyStatus: null,
    verifiedAt: null,
    score: 0.8,
    ...overrides,
  }
}

const profile = buildTasteProfile({
  starred: [
    { topics: ['cli', 'developer-tools'], language: 'TypeScript', embedding: null },
    { topics: ['cli'], language: 'TypeScript', embedding: null },
    { topics: ['mcp'], language: 'TypeScript', embedding: null },
  ],
})

describe('groupEvidence', () => {
  it('groups repos by the most profile-relevant topic', () => {
    const groups = groupEvidence(
      [
        makeRepo({ fullName: 'a/cli-1', topics: ['cli', 'typescript'], score: 0.9 }),
        makeRepo({ fullName: 'a/mcp-1', topics: ['mcp'], score: 0.7 }),
        makeRepo({ fullName: 'a/other', topics: ['unknown-topic'], score: 0.5 }),
      ],
      profile,
      3,
      3,
    )
    const topics = groups.map((group) => group.topic)
    expect(topics).toContain('cli')
    expect(topics).toContain('mcp')
    expect(topics).toContain('unknown-topic')
    const cliGroup = groups.find((group) => group.topic === 'cli')
    expect(cliGroup?.repos[0]?.fullName).toBe('a/cli-1')
  })

  it('caps groups and repos per group', () => {
    const repos = Array.from({ length: 10 }, (_, index) =>
      makeRepo({ fullName: `a/tool-${index}`, topics: [`topic-${index}`], score: 0.9 - index * 0.01 }),
    )
    const groups = groupEvidence(repos, null, 2, 1)
    expect(groups).toHaveLength(2)
    expect(groups.every((group) => group.repos.length === 1)).toBe(true)
  })
})

describe('summarizeProfile', () => {
  it('returns the strongest topics and languages', () => {
    const summary = summarizeProfile(profile)
    expect(summary?.topTopics[0]?.topic).toBe('cli')
    expect(summary?.topLanguages[0]?.language).toBe('TypeScript')
    expect(summarizeProfile(null)).toBeNull()
  })
})

describe('renderIssueMarkdown', () => {
  const evidence: IssueEvidence = {
    userName: 'demo',
    date: new Date('2026-10-30T00:00:00Z'),
    windowDays: 7,
    totalCandidates: 20,
    profile: summarizeProfile(profile),
    releases: [
      {
        repoFullName: 'acme/tool',
        tag: 'v1.2.3',
        name: '新版 | 重要',
        url: 'https://github.com/acme/tool/releases/tag/v1.2.3',
        publishedAt: '2026-10-29T00:00:00Z',
        isNew: true,
        isStarred: true,
      },
    ],
    groups: [{ topic: 'cli', repos: [makeRepo({ fullName: 'acme/tool' })] }],
    rising: [{ ...makeRepo({ fullName: 'fast/grower' }), growth: 0.25 }],
  }

  it('renders profile, releases, groups and edit hints', () => {
    const markdown = renderIssueMarkdown(evidence)
    expect(markdown).toContain('# RepoRadar 选题证据包 — demo')
    expect(markdown).toContain('| acme/tool | v1.2.3 | 2026-10-29 | 新 |')
    expect(markdown).toContain('### 主题：cli')
    expect(markdown).toContain('7 天 +25%')
    expect(markdown).toContain('## 编辑提示')
  })

  it('escapes pipes and newlines in table cells', () => {
    const markdown = renderIssueMarkdown({
      ...evidence,
      releases: [{ ...evidence.releases[0]!, name: 'a | b\nc' }],
    })
    expect(markdown).toContain('a \\| b c')
  })
})
