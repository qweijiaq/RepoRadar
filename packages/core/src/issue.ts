import type { TasteProfile } from './personalize.js'
import type { EnrichedRepoRecord } from './types.js'
import { round } from './utils.js'

export interface IssueRepoEvidence {
  fullName: string
  htmlUrl: string
  stars: number
  language: string | null
  topics: string[]
  summary: string | null
  reason: string | null
  score: number
  pushedAt: string | null
  verifyStatus: string | null
}

export interface IssueReleaseEvidence {
  repoFullName: string
  tag: string | null
  name: string | null
  url: string | null
  publishedAt: string | null
  isNew: boolean
  isStarred: boolean
}

export interface IssueGroup {
  topic: string
  repos: IssueRepoEvidence[]
}

export interface IssueProfileSummary {
  starredCount: number
  topTopics: Array<{ topic: string; weight: number }>
  topLanguages: Array<{ language: string; weight: number }>
}

export interface IssueEvidence {
  userName: string
  date: Date
  windowDays: number
  totalCandidates: number
  profile: IssueProfileSummary | null
  releases: IssueReleaseEvidence[]
  groups: IssueGroup[]
  rising: Array<IssueRepoEvidence & { growth: number }>
}

export function repoEvidence(repo: EnrichedRepoRecord & { score?: number }): IssueRepoEvidence {
  return {
    fullName: repo.fullName,
    htmlUrl: repo.htmlUrl,
    stars: repo.stars,
    language: repo.language,
    topics: repo.topics,
    summary: repo.summary ?? repo.description,
    reason: repo.reason,
    score: repo.score ?? 0,
    pushedAt: repo.pushedAt,
    verifyStatus: repo.verifyStatus,
  }
}

export function summarizeProfile(profile: TasteProfile | null): IssueProfileSummary | null {
  if (!profile) return null
  return {
    starredCount: profile.starredCount,
    topTopics: Object.entries(profile.topicWeights)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([topic, weight]) => ({ topic, weight })),
    topLanguages: Object.entries(profile.languageWeights)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([language, weight]) => ({ language, weight })),
  }
}

/**
 * 按「与画像最相关的 topic」把候选分组，每组取分数最高的几个。
 */
export function groupEvidence(
  repos: Array<EnrichedRepoRecord & { score: number }>,
  profile: TasteProfile | null,
  maxGroups = 3,
  perGroup = 3,
): IssueGroup[] {
  const weights = profile?.topicWeights ?? {}
  const buckets = new Map<string, Array<EnrichedRepoRecord & { score: number }>>()

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

  const groups: IssueGroup[] = []
  for (const [topic, items] of buckets) {
    const reposInGroup = items
      .sort((a, b) => b.score - a.score)
      .slice(0, perGroup)
      .map((repo) => repoEvidence(repo))
    groups.push({ topic, repos: reposInGroup })
  }

  const groupScore = (group: IssueGroup): number => group.repos.reduce((sum, repo) => sum + repo.score, 0)

  return groups.sort((a, b) => groupScore(b) - groupScore(a)).slice(0, maxGroups)
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim()
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function formatProfile(profile: IssueProfileSummary | null): string {
  if (!profile) return '- 暂无口味画像（先登录并同步 GitHub star）'
  const topics = profile.topTopics.map((item) => `${item.topic} ${Math.round(item.weight * 100)}%`).join('、')
  const languages = profile.topLanguages.map((item) => `${item.language} ${Math.round(item.weight * 100)}%`).join('、')
  return [
    `- star 数：${profile.starredCount}`,
    `- 主题权重：${topics || '（无）'}`,
    `- 语言权重：${languages || '（无）'}`,
  ].join('\n')
}

export function renderIssueMarkdown(evidence: IssueEvidence): string {
  const lines: string[] = [
    `# RepoRadar 选题证据包 — ${evidence.userName}`,
    '',
    `> ${formatDate(evidence.date)} · 候选池 ${evidence.totalCandidates} 个已富化项目 · 版本窗口 ${evidence.windowDays} 天`,
    '',
    '## 画像',
    '',
    formatProfile(evidence.profile),
    '',
    '## 你关注项目的版本变化',
    '',
  ]

  if (evidence.releases.length === 0) {
    lines.push('本轮没有检查到可用的 release。', '')
  } else {
    const withReleases = evidence.releases.filter((release) => release.tag)
    const withoutReleases = evidence.releases.length - withReleases.length

    if (withReleases.length === 0) {
      lines.push('本轮检查的仓库都没有可用的 release。', '')
    } else {
      lines.push('| 项目 | 版本 | 发布日期 | 状态 | 说明 |', '| --- | --- | --- | --- | --- |')
      for (const release of withReleases) {
        const status = release.isNew ? '新' : '已知'
        lines.push(
          `| ${escapeCell(release.repoFullName)} | ${escapeCell(release.tag ?? '—')} | ${release.publishedAt ? release.publishedAt.slice(0, 10) : '—'} | ${status} | ${escapeCell(release.name ?? '')} |`,
        )
      }
      lines.push('')
    }

    if (withoutReleases > 0) {
      lines.push(`> 另有 ${withoutReleases} 个仓库没有可用的 release。`, '')
    }
  }

  lines.push('## 候选项目（按主题聚类）', '')
  if (evidence.groups.length === 0) {
    lines.push('没有可用的候选项目。', '')
  } else {
    for (const group of evidence.groups) {
      lines.push(`### 主题：${group.topic}`, '')
      for (const repo of group.repos) {
        lines.push(
          `- **${repo.fullName}** ★ ${repo.stars.toLocaleString('en-US')} · ${repo.language ?? '未知语言'} · 分数 ${repo.score.toFixed(2)}`,
          `  - 摘要：${escapeCell(repo.summary ?? '（无）')}`,
          `  - topics：${repo.topics.slice(0, 8).join(', ') || '（无）'}`,
          `  - 最近推送：${repo.pushedAt ? repo.pushedAt.slice(0, 10) : '未知'}`,
          `  - 验证：${repo.verifyStatus === 'verified' ? '已验证' : '未验证'}`,
          `  - 链接：${repo.htmlUrl}`,
        )
      }
      lines.push('')
    }
  }

  lines.push('## 上升最快', '')
  if (evidence.rising.length === 0) {
    lines.push('暂无足够的 7 天 star 快照。', '')
  } else {
    for (const repo of evidence.rising) {
      lines.push(
        `- **${repo.fullName}** ★ ${repo.stars.toLocaleString('en-US')} · 7 天 +${round(repo.growth * 100, 1)}% · ${repo.language ?? '未知语言'}`,
      )
    }
    lines.push('')
  }

  lines.push(
    '## 编辑提示',
    '',
    '- 从上面的主题里挑 3 个，写成「变化 → 证据 → 对你的意义 → 行动」。',
    '- 版本变化里标记为「新」的条目优先；「已知」的可以作为背景。',
    '- 给出试用成本，并标明是否已经验证过。',
    '- 明确写出本周可以忽略的项目及原因。',
    '- 结尾给出下期选题，并说明反馈会如何影响排序。',
    '',
  )

  return `${lines.join('\n').trimEnd()}\n`
}
