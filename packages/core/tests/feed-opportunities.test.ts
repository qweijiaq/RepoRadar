import { describe, expect, it } from 'vitest'
import {
  buildFeedOpportunities,
  type OpportunityInput,
} from '../src/feed-opportunities.js'
import type { StoredIntegrationReport } from '../src/integrations.js'
import type { StoredMaintainerReport } from '../src/maintainer.js'
import type { StoredWatchMatch, WatchIntentRecord } from '../src/watch.js'

const maintainer: StoredMaintainerReport = {
  generatedAt: '2026-10-31T00:00:00Z',
  usedProjects: ['me/app'],
  warnings: [],
  report: {
    projects: [
      {
        repo: 'me/app',
        healthScore: 60,
        summary: '需要维护',
        strengths: [],
        risks: ['没有 CI'],
        actions: ['补 CI'],
        dependencies: [
          {
            name: 'next',
            current: '^15.0.0',
            latest: '16.0.0',
            risk: 'major',
            reason: '大版本升级',
            steps: [],
            vulnerabilities: [],
          },
        ],
        items: [
          {
            kind: 'issue',
            number: 7,
            title: '登录失败',
            priority: 'now',
            reason: '影响登录',
            action: '修复',
            draft: '我先复现',
          },
        ],
      },
    ],
  },
}

const integration: StoredIntegrationReport = {
  generatedAt: '2026-10-31T00:00:00Z',
  usedProjects: ['me/app'],
  auto: false,
  focus: null,
  report: {
    projects: [
      {
        repo: 'me/app',
        summary: '一个应用',
        gaps: ['缺少缓存'],
        suggestions: [
          {
            repo: 'lib/cache',
            kind: 'missing',
            reason: '补足缓存能力',
            action: 'try',
            steps: [],
            alreadyUsed: false,
          },
        ],
      },
    ],
  },
}

const intent: WatchIntentRecord = {
  id: 1,
  text: 'TypeScript 缓存项目',
  active: true,
  createdAt: '2026-10-31T00:00:00Z',
}
const matches: StoredWatchMatch[] = [
  { repo: 'indie/cache', score: 92, reason: '完全符合', createdAt: '2026-10-31T00:00:00Z' },
]

const input: OpportunityInput = {
  maintainer,
  integration,
  watch: [{ intent, matches }],
}

describe('buildFeedOpportunities', () => {
  it('picks one of each kind first and includes evidence', () => {
    const opportunities = buildFeedOpportunities(input)
    expect(opportunities).toHaveLength(3)
    expect(new Set(opportunities.map((item) => item.kind))).toEqual(
      new Set(['maintainer', 'dependency', 'watch']),
    )
    expect(
      opportunities.find((item) => item.kind === 'maintainer')?.evidence.some((text) => text.includes('现在处理')),
    ).toBe(true)
    expect(opportunities.find((item) => item.kind === 'watch')?.evidence).toContain('匹配度 92')
  })

  it('drops dismissed items', () => {
    const opportunities = buildFeedOpportunities({
      ...input,
      dismissed: new Set(['maintainer:me/app:issue:7']),
    })
    expect(opportunities.some((item) => item.key === 'maintainer:me/app:issue:7')).toBe(false)
  })

  it('falls back to dependency opportunities when triage is dismissed', () => {
    const opportunities = buildFeedOpportunities({
      ...input,
      dismissed: new Set(['maintainer:me/app:issue:7']),
    })
    expect(opportunities.length).toBe(3)
    expect(opportunities.some((item) => item.kind === 'dependency')).toBe(true)
  })
})
