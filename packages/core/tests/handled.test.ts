import { describe, expect, it } from 'vitest'
import {
  aggregateComparisonLibrary,
  aggregateDiscoverabilityLibrary,
} from '../src/recommendation-library.js'
import {
  filterIntegrationProjects,
  filterMaintainerReport,
  handledRepoNames,
  type HandledState,
} from '../src/handled.js'

function handled(overrides: Partial<HandledState> = {}): HandledState {
  return {
    dismissed: new Set(),
    done: new Set(),
    outcomes: new Map(),
    ...overrides,
  }
}

describe('handled helpers', () => {
  it('extracts recommended repository names from feed keys', () => {
    const names = handledRepoNames(
      handled({
        done: new Set(['gem:acme/one', 'watch:3:acme/two', 'maintainer:me/app:issue:1']),
        dismissed: new Set(['integration:me/app:acme/three']),
      }),
    )
    expect([...names].sort()).toEqual(['acme/one', 'acme/three', 'acme/two'])
  })

  it('filters handled maintainer items and dependencies', () => {
    const report = {
      projects: [
        {
          repo: 'me/app',
          healthScore: 60,
          summary: 'summary',
          strengths: [],
          risks: [],
          actions: [],
          dependencies: [
            {
              name: 'next',
              current: '14.0.0',
              latest: '15.0.0',
              risk: 'major' as const,
              reason: 'upgrade',
              steps: [],
              vulnerabilities: [],
            },
          ],
          items: [
            {
              kind: 'issue' as const,
              number: 7,
              title: 'bug',
              priority: 'now' as const,
              reason: 'fix',
              action: 'fix it',
              draft: '',
            },
          ],
        },
      ],
    }
    const filtered = filterMaintainerReport(
      report,
      handled({
        done: new Set([
          'maintainer:me/app:issue:7',
          'dependency:me/app:next:15.0.0',
        ]),
      }),
    )
    expect(filtered.projects[0]?.items).toEqual([])
    expect(filtered.projects[0]?.dependencies).toEqual([])
  })

  it('filters integration suggestions by outcome or feed key', () => {
    const projects = [
      {
        repo: 'me/app',
        summary: 'summary',
        gaps: [],
        suggestions: [
          {
            repo: 'acme/one',
            kind: 'missing' as const,
            reason: 'reason',
            action: 'try' as const,
            steps: [],
            alreadyUsed: false,
          },
          {
            repo: 'acme/two',
            kind: 'missing' as const,
            reason: 'reason',
            action: 'try' as const,
            steps: [],
            alreadyUsed: false,
          },
        ],
      },
    ]
    const filtered = filterIntegrationProjects(
      projects,
      handled({
        outcomes: new Map([['me/app|acme/one', 'adopted']]),
        dismissed: new Set(['integration:me/app:acme/two']),
      }),
    )
    expect(filtered).toEqual([])
  })
})

describe('comparison and discoverability libraries', () => {
  it('aggregates comparison candidates with handled status', () => {
    const library = aggregateComparisonLibrary(
      [
        {
          id: 1,
          createdAt: '2026-11-01T00:00:00.000Z',
          payload: {
            report: {
              project: 'me/app',
              summary: 'summary',
              recommendation: { repo: 'acme/one', reason: 'best' },
              candidates: [
                {
                  repo: 'acme/one',
                  fitScore: 90,
                  strengths: ['a'],
                  weaknesses: [],
                  migrationEffort: 'low',
                  reason: 'best fit',
                },
                {
                  repo: 'acme/two',
                  fitScore: 70,
                  strengths: ['b'],
                  weaknesses: [],
                  migrationEffort: 'medium',
                  reason: 'alternative',
                },
              ],
              nextSteps: [],
              capabilities: [],
            },
            generatedAt: '2026-11-01T00:00:00.000Z',
          },
        },
      ],
      handled({ outcomes: new Map([['me/app|acme/one', 'rejected']]) }),
    )
    expect(library.totals).toMatchObject({ items: 2, occurrences: 2, recommended: 1, rejected: 1 })
    expect(library.items.find((item) => item.repo === 'acme/one')).toMatchObject({
      recommended: 1,
      rejected: 1,
      bestFitScore: 90,
    })
  })

  it('aggregates discoverability scores and applied status', () => {
    const library = aggregateDiscoverabilityLibrary([
      {
        id: 1,
        repo: 'me/app',
        createdAt: '2026-11-01T00:00:00.000Z',
        payload: {
          report: {
            score: 60,
            summary: 'summary',
            dimensions: [],
            strengths: [],
            problems: [],
            suggestedDescription: 'description',
            suggestedTopics: [],
            readmeSuggestions: [],
            actions: [],
          },
          repo: 'me/app',
          generatedAt: '2026-11-01T00:00:00.000Z',
          appliedAt: '2026-11-01T01:00:00.000Z',
        },
      },
      {
        id: 2,
        repo: 'me/app',
        createdAt: '2026-11-02T00:00:00.000Z',
        payload: {
          report: {
            score: 78,
            summary: 'summary',
            dimensions: [],
            strengths: [],
            problems: [],
            suggestedDescription: 'description',
            suggestedTopics: [],
            readmeSuggestions: [],
            actions: [],
          },
          repo: 'me/app',
          generatedAt: '2026-11-02T00:00:00.000Z',
        },
      },
    ])
    expect(library.totals).toMatchObject({ items: 1, reports: 2, applied: 1, pending: 1 })
    expect(library.items[0]).toMatchObject({ latestScore: 78, bestScore: 78 })
  })
})
