import { describe, expect, it } from 'vitest'
import {
  buildDiscoverabilityBrief,
  parseDiscoverabilityReport,
  type DiscoverabilityReport,
} from '../src/discoverability.js'
import { normalizeTopics } from '../src/repo-management.js'

const report: DiscoverabilityReport = {
  score: 62,
  summary: '定位清楚，但搜索关键词覆盖不足',
  dimensions: [
    { name: '定位清晰度', score: 80, comment: '能看懂做什么' },
    { name: '搜索关键词', score: 45, comment: '缺少场景词' },
    { name: 'README 首屏', score: 60, comment: '安装步骤靠后' },
  ],
  strengths: ['有示例'],
  problems: ['描述太泛'],
  suggestedDescription: '一个面向终端用户的 AI 阅读助手，支持本地知识库与多模型接入。',
  suggestedTopics: ['ai-reader', 'knowledge-base', 'terminal'],
  readmeSuggestions: ['把截图放到首屏'],
  actions: [{ title: '重写描述', why: '描述太泛', how: '写明使用场景', impact: 'high' }],
}

describe('normalizeTopics', () => {
  it('normalizes and deduplicates GitHub topics', () => {
    expect(normalizeTopics(['AI Reader', 'ai-reader', '知识库', 'x'])).toEqual(['ai-reader'])
  })
})

describe('parseDiscoverabilityReport', () => {
  it('parses a valid report and cleans topics', () => {
    const parsed = parseDiscoverabilityReport(
      `说明文字\n\`\`\`json\n${JSON.stringify({ ...report, suggestedTopics: ['AI Reader'] })}\n\`\`\``,
    )
    expect(parsed.score).toBe(62)
    expect(parsed.suggestedTopics).toEqual(['ai-reader'])
  })

  it('rejects incomplete output', () => {
    expect(() => parseDiscoverabilityReport('{"score":80}')).toThrow()
  })
})

describe('buildDiscoverabilityBrief', () => {
  it('contains the score, suggestions and safety note', () => {
    const brief = buildDiscoverabilityBrief({
      report,
      repo: 'me/app',
      generatedAt: '2026-10-31T00:00:00Z',
    })
    expect(brief).toContain('me/app')
    expect(brief).toContain('62/100')
    expect(brief).toContain('ai-reader')
    expect(brief).toContain('不要夸大或编造功能')
  })
})
