import { describe, expect, it } from 'vitest'
import { buildMaintainerBrief } from '../src/maintainer-brief.js'
import {
  groundMaintainerReport,
  parseMaintainerReport,
  type MaintainerProjectInput,
  type MaintainerReport,
} from '../src/maintainer.js'

const project: MaintainerProjectInput = {
  repo: 'me/app',
  description: 'Web 应用',
  language: 'TypeScript',
  topics: ['web'],
  readme: '# app',
  manifestName: 'package.json',
  manifest: '{"dependencies":{"next":"^15.0.0"}}',
  dependencies: [
    {
      name: 'next',
      ecosystem: 'npm',
      dev: false,
      declared: '^15.0.0',
      installed: '15.0.0',
      latest: '16.0.0',
      repo: 'vercel/next.js',
      outdated: true,
      risk: 'major',
      deprecated: false,
      releaseNotes: null,
      releaseUrl: null,
      vulnerabilities: [],
    },
  ],
  signals: {
    stars: 10,
    forks: 2,
    openIssues: 4,
    openPulls: 1,
    lastPushedAt: '2026-10-30T00:00:00Z',
    archived: false,
    license: 'MIT',
    hasTests: true,
    hasCi: false,
  },
  items: [
    {
      kind: 'issue',
      number: 7,
      title: '登录失败',
      labels: ['bug'],
      comments: 2,
      ageDays: 3,
      body: '复现步骤…',
      draft: null,
    },
  ],
}

const report: MaintainerReport = {
  projects: [
    {
      repo: 'me/app',
      healthScore: 72,
      summary: '基础健康，缺 CI',
      strengths: ['有测试'],
      risks: ['没有 CI'],
      actions: ['补 CI', '升级 next'],
      dependencies: [
        {
          name: 'next',
          current: '^15.0.0',
          latest: '16.0.0',
          risk: 'major',
          reason: '大版本升级',
          steps: ['先看迁移指南'],
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
          action: '复现并修复',
          draft: '收到，我先复现。',
        },
      ],
    },
  ],
}

describe('parseMaintainerReport', () => {
  it('parses a valid report', () => {
    const parsed = parseMaintainerReport(JSON.stringify(report))
    expect(parsed.projects[0]?.healthScore).toBe(72)
    expect(parsed.projects[0]?.items[0]?.number).toBe(7)
  })

  it('drops malformed triage items', () => {
    const parsed = parseMaintainerReport(
      JSON.stringify({
        projects: [
          {
            ...report.projects[0],
            items: [{ kind: 'issue', number: 7 }, report.projects[0]!.items[0]],
          },
        ],
      }),
    )
    expect(parsed.projects[0]?.items).toHaveLength(1)
  })

  it('rejects non-JSON', () => {
    expect(() => parseMaintainerReport('hello')).toThrow()
  })
})

describe('groundMaintainerReport', () => {
  it('removes unknown projects, dependencies and issue numbers', () => {
    const parsed = parseMaintainerReport(JSON.stringify(report))
    const grounded = groundMaintainerReport(parsed, [project])
    expect(grounded.projects).toHaveLength(1)
    expect(grounded.projects[0]?.dependencies).toHaveLength(1)
    expect(grounded.projects[0]?.items).toHaveLength(1)

    const unknown = parseMaintainerReport(
      JSON.stringify({
        projects: [
          {
            ...report.projects[0],
            dependencies: [{ ...report.projects[0]!.dependencies[0], name: 'ghost' }],
            items: [{ ...report.projects[0]!.items[0], number: 99 }],
          },
        ],
      }),
    )
    const cleaned = groundMaintainerReport(unknown, [project])
    expect(cleaned.projects[0]?.dependencies).toHaveLength(0)
    expect(cleaned.projects[0]?.items).toHaveLength(0)
  })
})

describe('buildMaintainerBrief', () => {
  it('includes health, dependency and triage instructions', () => {
    const brief = buildMaintainerBrief(report, { generatedAt: '2026-10-31', warnings: ['缺 CI 数据'] })
    expect(brief).toContain('# RepoRadar 维护周报任务书')
    expect(brief).toContain('健康分：72/100')
    expect(brief).toContain('next')
    expect(brief).toContain('大版本')
    expect(brief).toContain('Issue #7')
    expect(brief).toContain('不要自动发布')
    expect(brief).toContain('缺 CI 数据')
  })
})
