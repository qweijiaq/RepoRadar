import { describe, expect, it } from 'vitest'
import {
  buildIssuePlanBrief,
  groundIssuePlan,
  parseIssuePlan,
  type IssueContext,
} from '../src/issue-plan.js'

const context: IssueContext = {
  repo: 'me/app',
  number: 7,
  title: '登录失败',
  body: '点击登录没有反应',
  labels: ['bug'],
  author: 'alice',
  comments: [{ author: 'bob', body: '只在 Safari 复现' }],
  files: ['src/auth/login.ts', 'src/auth/session.ts'],
}

const plan = {
  summary: '可能是 Safari 下表单提交事件未触发。',
  likelyFiles: ['src/auth/login.ts', 'missing/file.ts'],
  steps: ['复现问题', '修复事件绑定'],
  tests: ['补 Safari 回归测试'],
  risks: ['影响其他浏览器'],
  acceptance: ['Safari 登录成功'],
}

describe('parseIssuePlan', () => {
  it('parses a valid plan', () => {
    const parsed = parseIssuePlan(JSON.stringify(plan))
    expect(parsed.steps).toHaveLength(2)
  })

  it('rejects output without steps', () => {
    expect(() => parseIssuePlan('{"summary":"x"}')).toThrow()
  })
})

describe('groundIssuePlan', () => {
  it('drops files that are not in the repository tree', () => {
    const grounded = groundIssuePlan(parseIssuePlan(JSON.stringify(plan)), context)
    expect(grounded.likelyFiles).toEqual(['src/auth/login.ts'])
  })
})

describe('buildIssuePlanBrief', () => {
  it('includes the issue, steps and safety constraints', () => {
    const brief = buildIssuePlanBrief({
      plan: parseIssuePlan(JSON.stringify(plan)),
      repo: 'me/app',
      issueNumber: 7,
      issueTitle: '登录失败',
      generatedAt: '2026-10-31T00:00:00Z',
    })
    expect(brief).toContain('me/app #7')
    expect(brief).toContain('登录失败')
    expect(brief).toContain('复现问题')
    expect(brief).toContain('不要自动提交')
  })
})
