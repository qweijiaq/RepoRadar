import type { StoredIntegrationReport } from './integrations.js'
import type { StoredMaintainerReport } from './maintainer.js'
import type { StoredWatchMatch, WatchIntentRecord } from './watch.js'

export type OpportunityKind = 'maintainer' | 'dependency' | 'integration' | 'watch'

export interface FeedOpportunity {
  key: string
  kind: OpportunityKind
  title: string
  detail: string
  href: string
  repo: string | null
  evidence: string[]
  priority: number
}

export interface OpportunityInput {
  maintainer: StoredMaintainerReport | null
  integration: StoredIntegrationReport | null
  watch: Array<{ intent: WatchIntentRecord; matches: StoredWatchMatch[] }>
  dismissed?: Set<string>
  kinds?: OpportunityKind[]
  limit?: number
}

export const OPPORTUNITY_LABEL: Record<OpportunityKind, string> = {
  maintainer: '维护待办',
  dependency: '依赖风险',
  integration: '补你的项目',
  watch: '关注命中',
}

const PRIORITY_LABEL: Record<string, string> = {
  now: '现在处理',
  week: '本周处理',
  later: '稍后处理',
}

function priorityForItem(priority: string): number {
  if (priority === 'now') return 100
  if (priority === 'week') return 80
  return 45
}

/**
 * 从维护周报、接入报告和关注代理里聚合「今天值得做的事」。
 * 每种类型先各取一条，再补高分项，避免首屏被同一种建议占满。
 */
export function buildFeedOpportunities(input: OpportunityInput): FeedOpportunity[] {
  const items: FeedOpportunity[] = []

  for (const project of input.maintainer?.report.projects ?? []) {
    for (const item of project.items) {
      items.push({
        key: `maintainer:${project.repo}:${item.kind}:${item.number}`,
        kind: 'maintainer',
        title: `${project.repo} · ${item.kind === 'pull' ? 'PR' : 'Issue'} #${item.number}`,
        detail: `${item.title}：${item.reason}`,
        href: '/maintain',
        repo: project.repo,
        evidence: [
          `维护周报标记为${PRIORITY_LABEL[item.priority] ?? item.priority}`,
          ...(item.draft ? ['已生成回复草稿'] : []),
        ],
        priority: priorityForItem(item.priority),
      })
    }

    for (const dependency of project.dependencies) {
      if (dependency.risk !== 'major' && dependency.risk !== 'minor') continue
      items.push({
        key: `dependency:${project.repo}:${dependency.name}:${dependency.latest ?? 'unknown'}`,
        kind: 'dependency',
        title: `${project.repo} 的 ${dependency.name} 需要升级`,
        detail: dependency.reason,
        href: '/maintain',
        repo: project.repo,
        evidence: [
          `${dependency.current ?? '未知'} → ${dependency.latest ?? '未知'}`,
          dependency.risk === 'major' ? '大版本风险' : '小版本升级',
        ],
        priority: dependency.risk === 'major' ? 92 : 65,
      })
    }
  }

  for (const project of input.integration?.report.projects ?? []) {
    for (const suggestion of project.suggestions) {
      if (suggestion.action === 'watch' && suggestion.kind !== 'missing') continue
      items.push({
        key: `integration:${project.repo}:${suggestion.repo}`,
        kind: 'integration',
        title:
          suggestion.kind === 'missing'
            ? `给 ${project.repo} 补 ${suggestion.repo}`
            : `${project.repo} 可以考虑替换为 ${suggestion.repo}`,
        detail: suggestion.reason,
        href: '/integrations',
        repo: suggestion.repo,
        evidence: [suggestion.kind === 'missing' ? '缺失能力' : '可优化', suggestion.repo],
        priority: suggestion.kind === 'missing' ? 86 : 62,
      })
    }
  }

  for (const entry of input.watch) {
    for (const match of entry.matches) {
      items.push({
        key: `watch:${entry.intent.id}:${match.repo}`,
        kind: 'watch',
        title: `关注代理命中 ${match.repo}`,
        detail: match.reason,
        href: '/watch',
        repo: match.repo,
        evidence: [`「${entry.intent.text}」`, `匹配度 ${match.score}`],
        priority: match.score >= 90 ? 96 : match.score >= 80 ? 76 : 55,
      })
    }
  }

  const allowedKinds = input.kinds ? new Set(input.kinds) : null
  const limit = input.limit ?? 3
  const available = items
    .filter((item) => !input.dismissed?.has(item.key))
    .filter((item) => !allowedKinds || allowedKinds.has(item.kind))
    .sort((left, right) => right.priority - left.priority)

  const picked: FeedOpportunity[] = []
  const seenKeys = new Set<string>()
  const seenKinds = new Set<OpportunityKind>()
  for (const item of available) {
    if (picked.length >= limit) break
    if (seenKeys.has(item.key) || seenKinds.has(item.kind)) continue
    picked.push(item)
    seenKeys.add(item.key)
    seenKinds.add(item.kind)
  }
  for (const item of available) {
    if (picked.length >= limit) break
    if (seenKeys.has(item.key)) continue
    picked.push(item)
    seenKeys.add(item.key)
  }

  return picked
}
