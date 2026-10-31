import { describe, expect, it } from 'vitest'
import { buildIntegrationBrief, buildProjectIntegrationBrief } from '../src/integration-brief.js'
import type { IntegrationProject } from '../src/integrations.js'

const project: IntegrationProject = {
  repo: 'me/app',
  summary: '一个 Web 应用',
  gaps: ['缺少鉴权', '测试覆盖不足'],
  suggestions: [
    {
      repo: 'lib/auth',
      kind: 'missing',
      reason: '补足登录与会话管理',
      action: 'try',
      steps: ['安装 lib/auth', '在登录路由接入回调'],
      alreadyUsed: false,
    },
    {
      repo: 'lib/test',
      kind: 'optimize',
      reason: '现有测试工具可以替换',
      action: 'watch',
      steps: [],
      alreadyUsed: true,
    },
  ],
}

describe('buildIntegrationBrief', () => {
  it('renders an executable AI brief with context and steps', () => {
    const brief = buildIntegrationBrief([project], {
      generatedAt: '2026-10-31 10:00',
      focus: '补鉴权',
      usedProjects: ['me/app'],
      auto: true,
    })

    expect(brief).toContain('# RepoRadar 接入任务书')
    expect(brief).toContain('本轮关注：补鉴权')
    expect(brief).toContain('https://github.com/me/app')
    expect(brief).toContain('https://github.com/lib/auth')
    expect(brief).toContain('类型：缺失功能')
    expect(brief).toContain('参考步骤')
    expect(brief).toContain('安装 lib/auth')
    expect(brief).toContain('依赖中已经存在')
    expect(brief).toContain('只修改目标项目')
    expect(brief).toContain('test / lint / typecheck / build')
  })

  it('creates a single-project brief', () => {
    const brief = buildProjectIntegrationBrief(project)
    expect(brief).toContain('# RepoRadar 接入任务书 · me/app')
    expect(brief).toContain('## 目标项目：[me/app]')
  })

  it('keeps the full-report title even with one project', () => {
    const brief = buildIntegrationBrief([project])
    expect(brief.startsWith('# RepoRadar 接入任务书\n')).toBe(true)
  })

  it('includes every project in the full report', () => {
    const brief = buildIntegrationBrief([project, { ...project, repo: 'me/other', summary: '另一个项目' }])
    expect(brief).toContain('me/app')
    expect(brief).toContain('me/other')
    expect(brief.match(/## 目标项目/g)).toHaveLength(2)
  })

  it('handles projects without suggestions', () => {
    const brief = buildIntegrationBrief([{ ...project, suggestions: [] }])
    expect(brief).toContain('暂无候选建议')
  })

  it('handles an empty report', () => {
    expect(buildIntegrationBrief([])).toContain('暂无可执行的项目建议')
  })
})
