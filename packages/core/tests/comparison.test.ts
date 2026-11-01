import { describe, expect, it } from 'vitest'
import {
  buildComparisonBrief,
  groundComparisonReport,
  parseComparisonReport,
  type ComparisonCandidateInput,
  type ComparisonProjectInput,
} from '../src/comparison.js'

const project: ComparisonProjectInput = {
  repo: 'me/app',
  description: 'Web 应用',
  language: 'TypeScript',
  topics: ['web'],
  dependencies: ['next'],
  readme: '# app',
  manifestName: 'package.json',
  manifest: '{}',
}

const candidates: ComparisonCandidateInput[] = [
  { repo: 'lib/a', summary: 'A', language: 'TypeScript', topics: ['web'], stars: 100, readme: null },
  { repo: 'lib/b', summary: 'B', language: 'Go', topics: ['api'], stars: 50, readme: null },
]

const report = {
  project: 'me/app',
  summary: 'A 更贴合现有栈',
  recommendation: { repo: 'lib/a', reason: '同语言、依赖更少' },
  candidates: [
    {
      repo: 'lib/a',
      fitScore: 88,
      strengths: ['同语言'],
      weaknesses: ['较新'],
      migrationEffort: 'low',
      reason: '适合现有技术栈',
    },
    {
      repo: 'lib/b',
      fitScore: 60,
      strengths: ['性能好'],
      weaknesses: ['跨语言'],
      migrationEffort: 'high',
      reason: '适合高并发场景',
    },
  ],
  nextSteps: ['先做 spike'],
  capabilities: [],
}

describe('parseComparisonReport', () => {
  it('parses a valid report', () => {
    const parsed = parseComparisonReport(`说明\n${JSON.stringify(report)}`)
    expect(parsed.candidates).toHaveLength(2)
  })

  it('rejects a report without candidates', () => {
    expect(() => parseComparisonReport('{"summary":"x"}')).toThrow()
  })
})

describe('capabilities', () => {
  it('keeps only known repos and drops rows without enough support', () => {
    const parsed = parseComparisonReport(
      JSON.stringify({
        ...report,
        capabilities: [
          {
            name: '类型支持',
            support: { 'me/app': 'partial', 'lib/a': 'yes', 'lib/b': 'no', 'evil/x': 'yes' },
            note: 'A 自带类型',
            evidence: 'README',
          },
          { name: '空行', support: { 'evil/x': 'yes' } },
        ],
      }),
    )
    const grounded = groundComparisonReport(parsed, project, candidates)
    expect(grounded.capabilities).toHaveLength(1)
    expect(grounded.capabilities[0]?.support).toEqual({
      'me/app': 'partial',
      'lib/a': 'yes',
      'lib/b': 'no',
    })
  })
})

describe('groundComparisonReport', () => {
  it('filters unknown candidates and fixes an invalid recommendation', () => {
    const parsed = parseComparisonReport(
      JSON.stringify({
        ...report,
        recommendation: { repo: 'ghost/repo', reason: '不存在的候选' },
        candidates: [...report.candidates, { ...report.candidates[0], repo: 'ghost/repo' }],
      }),
    )
    const grounded = groundComparisonReport(parsed, project, candidates)
    expect(grounded.candidates.map((candidate) => candidate.repo)).toEqual(['lib/a', 'lib/b'])
    expect(grounded.recommendation.repo).toBe('lib/a')
  })
})

describe('buildComparisonBrief', () => {
  it('includes recommendation and migration effort', () => {
    const brief = buildComparisonBrief({
      report: parseComparisonReport(JSON.stringify(report)),
      generatedAt: '2026-10-31T00:00:00Z',
    })
    expect(brief).toContain('推荐：lib/a')
    expect(brief).toContain('迁移成本：low')
    expect(brief).toContain('先做 spike')
  })
})
