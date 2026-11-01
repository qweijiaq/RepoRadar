import { describe, expect, it } from 'vitest'
import {
  aggregateIntegrationLibrary,
  aggregateMaintainerLibrary,
  aggregateWatchLibrary,
  type IntegrationReportRecord,
  type MaintainerReportRecord,
  type WatchLibraryMatch,
} from '../src/recommendation-library.js'

function report(
  id: number,
  createdAt: string,
  project: string,
  repo: string,
  reason = '补齐能力',
): IntegrationReportRecord {
  return {
    id,
    createdAt,
    payload: {
      report: {
        projects: [
          {
            repo: project,
            summary: '项目摘要',
            gaps: ['缺口'],
            suggestions: [
              {
                repo,
                kind: 'missing',
                reason,
                action: 'try',
                steps: ['安装'],
                alreadyUsed: false,
              },
            ],
          },
        ],
      },
      usedProjects: [project],
      auto: false,
      focus: null,
      generatedAt: createdAt,
    },
  }
}

describe('aggregateIntegrationLibrary', () => {
  it('counts reports, projects and statuses per repository', () => {
    const library = aggregateIntegrationLibrary(
      [
        report(3, '2026-11-03T00:00:00.000Z', 'me/app', 'acme/lib', '最新的理由'),
        report(2, '2026-11-02T00:00:00.000Z', 'me/other', 'acme/lib'),
        report(1, '2026-11-01T00:00:00.000Z', 'me/app', 'acme/lib'),
      ],
      [
        {
          projectFullName: 'me/app',
          suggestionRepo: 'acme/lib',
          status: 'adopted',
          note: null,
          updatedAt: '2026-11-02T00:00:00.000Z',
        },
        {
          projectFullName: 'me/other',
          suggestionRepo: 'acme/lib',
          status: 'rejected',
          note: null,
          updatedAt: '2026-11-02T00:00:00.000Z',
        },
      ],
      [],
      ['integration:me/app:acme/lib'],
    )

    expect(library.totals).toMatchObject({
      items: 1,
      occurrences: 3,
      reports: 3,
      adopted: 2,
      rejected: 1,
      pending: 0,
    })
    const item = library.items[0]!
    expect(item).toMatchObject({
      repo: 'acme/lib',
      total: 3,
      reports: 3,
      latestReason: '最新的理由',
      latestProject: 'me/app',
    })
    expect(item.projects).toEqual(['me/app', 'me/other'])
    expect(item.occurrences[0]).toMatchObject({
      reportId: 3,
      project: 'me/app',
      status: 'adopted',
    })
  })

  it('treats feed dismissals as rejected and feed done as adopted', () => {
    const library = aggregateIntegrationLibrary(
      [
        report(2, '2026-11-02T00:00:00.000Z', 'me/other', 'acme/lib'),
        report(1, '2026-11-01T00:00:00.000Z', 'me/app', 'acme/lib'),
      ],
      [],
      ['integration:me/other:acme/lib'],
      ['integration:me/app:acme/lib'],
    )
    expect(library.items[0]).toMatchObject({ adopted: 1, rejected: 1, pending: 0 })
  })
})

describe('aggregateWatchLibrary', () => {
  it('aggregates intent matches and merges handled status', () => {
    const matches: WatchLibraryMatch[] = [
      {
        intentId: 1,
        intent: '长期记忆',
        repo: 'acme/memory',
        score: 90,
        reason: '匹配长期记忆',
        at: '2026-11-02T00:00:00.000Z',
      },
      {
        intentId: 2,
        intent: 'agent 工具',
        repo: 'acme/memory',
        score: 70,
        reason: '也能用于 agent',
        at: '2026-11-01T00:00:00.000Z',
      },
    ]
    const library = aggregateWatchLibrary(
      matches,
      ['watch:2:acme/memory'],
      ['watch:1:acme/memory'],
    )
    expect(library.totals).toMatchObject({
      items: 1,
      matches: 2,
      intents: 2,
      adopted: 1,
      rejected: 1,
      pending: 0,
    })
    expect(library.items[0]).toMatchObject({
      repo: 'acme/memory',
      total: 2,
      bestScore: 90,
      latestReason: '匹配长期记忆',
    })
    expect(library.items[0]?.intents).toEqual(['长期记忆', 'agent 工具'])
  })
})


describe('aggregateMaintainerLibrary', () => {
  it('aggregates issue and dependency follow-ups across weekly reports', () => {
    const makeReport = (id: number, at: string): MaintainerReportRecord => ({
      id,
      createdAt: at,
      payload: {
        report: {
          projects: [
            {
              repo: 'me/app',
              healthScore: 70,
              summary: '项目摘要',
              strengths: [],
              risks: [],
              actions: [],
              dependencies: [
                {
                  name: 'next',
                  current: '14.0.0',
                  latest: '15.0.0',
                  risk: 'major',
                  reason: '需要升级',
                  steps: [],
                  vulnerabilities: [],
                },
              ],
              items: [
                {
                  kind: 'issue',
                  number: 7,
                  title: '崩溃',
                  priority: 'now',
                  reason: '用户反馈',
                  action: '修复',
                  draft: '',
                },
              ],
            },
          ],
        },
        usedProjects: ['me/app'],
        warnings: [],
        generatedAt: at,
      },
    })
    const library = aggregateMaintainerLibrary(
      [makeReport(2, '2026-11-02T00:00:00.000Z'), makeReport(1, '2026-11-01T00:00:00.000Z')],
      [],
      ['maintainer:me/app:issue:7', 'dependency:me/app:next:15.0.0'],
    )
    expect(library.totals).toMatchObject({
      items: 2,
      occurrences: 4,
      reports: 2,
      projects: 1,
      adopted: 4,
      rejected: 0,
      pending: 0,
    })
    expect(library.items.map((item) => item.label)).toEqual([
      'me/app · Issue #7',
      'me/app · next',
    ])
    expect(library.items[0]?.reports).toBe(2)
  })
})
