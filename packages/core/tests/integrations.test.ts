import { describe, expect, it } from 'vitest'
import {
  applyCandidateFlags,
  buildDiscoveryQueries,
  buildIntegrationPrompt,
  extractJsonObjects,
  filterHandledSuggestions,
  groundIntegrationReport,
  isDependencyUsed,
  parseIntegrationReport,
  type IntegrationCandidate,
  type IntegrationProjectInput,
} from '../src/integrations.js'

const report = {
  projects: [
    {
      repo: 'me/app',
      summary: '一个 Web 应用',
      gaps: ['缺少缓存层'],
      suggestions: [
        { repo: 'lib/cache', kind: 'missing', reason: '补足缓存能力', action: 'try' },
        { repo: 'ghost/unknown', kind: 'optimize', reason: '不存在的候选', action: 'watch' },
      ],
    },
  ],
}

const project: IntegrationProjectInput = {
  repo: 'me/app',
  description: 'Web 应用',
  language: 'TypeScript',
  topics: ['web', 'cache'],
  dependencies: ['next', 'zod'],
  readme: '# app',
  manifestName: 'package.json',
  manifest: '{"dependencies":{}}',
}

const candidate: IntegrationCandidate = {
  repo: 'lib/cache',
  summary: '缓存库',
  language: 'TypeScript',
  topics: ['cache'],
  stars: 100,
  verified: true,
  reason: '近期活跃',
  alreadyUsed: false,
}

describe('parseIntegrationReport', () => {
  it('parses JSON in a code fence', () => {
    const parsed = parseIntegrationReport('```json\n' + JSON.stringify(report) + '\n```')
    expect(parsed.projects[0]?.repo).toBe('me/app')
  })

  it('rejects non-JSON output', () => {
    expect(() => parseIntegrationReport('没有 JSON')).toThrow()
  })

  it('finds the report after prose that contains braces', () => {
    const raw = `好的 {这不是 JSON}，结果如下：\n${JSON.stringify(report)}\n以上。`
    expect(parseIntegrationReport(raw).projects).toHaveLength(1)
  })

  it('uses the first valid report when multiple objects are present', () => {
    const raw = `${JSON.stringify({ note: 'prefix' })}\n${JSON.stringify(report)}`
    expect(parseIntegrationReport(raw).projects[0]?.repo).toBe('me/app')
  })

  it('reports truncation with a clear message', () => {
    expect(() => parseIntegrationReport('{"projects":[{"repo":"me/app"')).toThrow(/截断/)
  })

  it('drops malformed suggestions but keeps the project', () => {
    const raw = JSON.stringify({
      projects: [
        {
          repo: 'me/app',
          summary: '一个应用',
          gaps: ['缺少缓存'],
          suggestions: [{ repo: 'lib/cache' }, report.projects[0]!.suggestions[0]],
        },
      ],
    })
    const parsed = parseIntegrationReport(raw)
    expect(parsed.projects[0]?.suggestions).toHaveLength(1)
  })
})

describe('extractJsonObjects', () => {
  it('ignores braces inside strings', () => {
    const objects = extractJsonObjects('{"a":"} not the end {","b":{"c":1}} tail')
    expect(objects).toHaveLength(1)
    expect(JSON.parse(objects[0]!)).toEqual({ a: '} not the end {', b: { c: 1 } })
  })

  it('returns later objects when earlier braces are unbalanced', () => {
    const objects = extractJsonObjects('{ broken\n{"ok":true}')
    expect(objects.some((object) => object === '{"ok":true}')).toBe(true)
  })
})

describe('groundIntegrationReport', () => {
  it('keeps only known projects and candidates', () => {
    const grounded = groundIntegrationReport(parseIntegrationReport(JSON.stringify(report)), ['me/app'], ['lib/cache'])
    expect(grounded.projects).toHaveLength(1)
    expect(grounded.projects[0]?.suggestions.map((suggestion) => suggestion.repo)).toEqual(['lib/cache'])
  })

  it('drops projects that are not in the input', () => {
    const grounded = groundIntegrationReport(parseIntegrationReport(JSON.stringify(report)), [], ['lib/cache'])
    expect(grounded.projects).toHaveLength(0)
  })
})

describe('buildIntegrationPrompt', () => {
  it('includes project context and candidate repos', () => {
    const prompt = buildIntegrationPrompt([project], [candidate])
    expect(prompt).toContain('me/app')
    expect(prompt).toContain('lib/cache')
    expect(prompt).toContain('package.json')
    expect(prompt).toContain('zod')
  })

  it('includes the focus line when provided', () => {
    const prompt = buildIntegrationPrompt([project], [candidate], '补可观测性')
    expect(prompt).toContain('本轮重点关注：补可观测性')
  })

  it('includes adopted and rejected history', () => {
    const prompt = buildIntegrationPrompt([project], [candidate], null, [
      { projectFullName: 'me/app', suggestionRepo: 'lib/adopted', status: 'adopted' },
      { projectFullName: 'me/app', suggestionRepo: 'lib/rejected', status: 'rejected' },
    ])
    expect(prompt).toContain('用户之前采纳过')
    expect(prompt).toContain('lib/adopted')
    expect(prompt).toContain('不要在同一项目里再次推荐')
  })
})

describe('suggestion steps', () => {
  it('defaults steps to an empty array', () => {
    const parsed = parseIntegrationReport(JSON.stringify(report))
    expect(parsed.projects[0]?.suggestions[0]?.steps).toEqual([])
  })

  it('keeps provided steps', () => {
    const raw = JSON.stringify({
      projects: [
        {
          repo: 'me/app',
          summary: '一个 Web 应用',
          gaps: ['缺少缓存'],
          suggestions: [
            {
              repo: 'lib/cache',
              kind: 'missing',
              reason: '补足缓存能力',
              action: 'try',
              steps: ['安装 lib/cache', '在读取路径加一层缓存'],
            },
          ],
        },
      ],
    })
    const parsed = parseIntegrationReport(raw)
    expect(parsed.projects[0]?.suggestions[0]?.steps).toHaveLength(2)
  })
})

describe('applyCandidateFlags', () => {
  it('marks suggestions whose candidate is already a dependency', () => {
    const parsed = parseIntegrationReport(JSON.stringify(report))
    const flagged = applyCandidateFlags(parsed, [{ ...candidate, alreadyUsed: true }])
    expect(flagged.projects[0]?.suggestions[0]?.alreadyUsed).toBe(true)
  })
})

describe('filterHandledSuggestions', () => {
  it('removes suggestions the user rejected for that project', () => {
    const parsed = groundIntegrationReport(parseIntegrationReport(JSON.stringify(report)), ['me/app'], ['lib/cache'])
    const filtered = filterHandledSuggestions(parsed, [
      { projectFullName: 'me/app', suggestionRepo: 'lib/cache', status: 'rejected' },
    ])
    expect(filtered.projects[0]?.suggestions).toHaveLength(0)
  })

  it('removes suggestions already adopted', () => {
    const parsed = groundIntegrationReport(parseIntegrationReport(JSON.stringify(report)), ['me/app'], ['lib/cache'])
    const filtered = filterHandledSuggestions(parsed, [
      { projectFullName: 'me/app', suggestionRepo: 'lib/cache', status: 'adopted' },
    ])
    expect(filtered.projects[0]?.suggestions).toHaveLength(0)
  })

  it('keeps suggestions handled for other projects', () => {
    const parsed = groundIntegrationReport(parseIntegrationReport(JSON.stringify(report)), ['me/app'], ['lib/cache'])
    const filtered = filterHandledSuggestions(parsed, [
      { projectFullName: 'me/other', suggestionRepo: 'lib/cache', status: 'rejected' },
    ])
    expect(filtered.projects[0]?.suggestions).toHaveLength(1)
  })
})

describe('buildDiscoveryQueries', () => {
  it('builds topic and language queries with freshness filters', () => {
    const queries = buildDiscoveryQueries([project], { now: new Date('2026-10-30T00:00:00Z'), days: 180 })
    expect(queries).toHaveLength(2)
    expect(queries[0]).toContain('topic:web')
    expect(queries[0]).toContain('language:TypeScript')
    expect(queries[0]).toContain('pushed:>=2026-05-03')
    expect(queries[0]).toContain('stars:>=50')
  })

  it('deduplicates topics across projects and caps queries', () => {
    const queries = buildDiscoveryQueries([project, { ...project, repo: 'me/other' }], { maxQueries: 1 })
    expect(queries).toHaveLength(1)
  })
})

describe('isDependencyUsed', () => {
  it('matches package names, scoped names and full repo names', () => {
    expect(isDependencyUsed('lib/cache', ['cache'])).toBe(true)
    expect(isDependencyUsed('scope/pkg', ['@scope/pkg'])).toBe(true)
    expect(isDependencyUsed('scope/other', ['@scope/pkg'])).toBe(false)
  })
})
