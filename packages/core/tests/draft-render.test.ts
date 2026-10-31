import { describe, expect, it } from 'vitest'
import { renderDraftHtml, renderDraftMarkdown } from '../src/draft-render.js'
import type { IssueEvidence } from '../src/issue.js'
import type { IssueDraft } from '../src/narrative.js'

const evidence: IssueEvidence = {
  userName: 'demo',
  date: new Date('2026-10-30T00:00:00Z'),
  windowDays: 7,
  totalCandidates: 10,
  profile: {
    starredCount: 5,
    topTopics: [{ topic: 'cli', weight: 1 }],
    topLanguages: [{ language: 'TypeScript', weight: 1 }],
  },
  releases: [],
  groups: [],
  rising: [],
}

const draft: IssueDraft = {
  title: '终端工具本周的变化',
  summary: ['第一条结论。', '第二条结论。'],
  themes: [
    {
      title: '终端工具',
      judgment: '终端工具在加速迭代。',
      items: [
        {
          repo: 'acme/tool',
          name: 'Tool <script>alert(1)</script>',
          change: '发布 v1.2.0',
          evidence: '10-28 发布，1234 stars',
          relevance: '和你的工作流相关',
          action: 'try',
          cost: '估计 2 分钟',
        },
      ],
    },
  ],
  ignore: [{ repo: 'acme/other', reason: '与你的工作流无关' }],
  next: ['下期选题'],
}

describe('renderDraftMarkdown', () => {
  it('renders the issue structure', () => {
    const markdown = renderDraftMarkdown(draft, evidence)
    expect(markdown).toContain('# RepoRadar 周报 · 2026-10-30')
    expect(markdown).toContain('## 01 终端工具')
    expect(markdown).toContain('- **行动**：**值得试** 估计 2 分钟')
    expect(markdown).toContain('## 本周可以忽略')
    expect(markdown).toContain('## 下期想看什么？')
  })
})

describe('renderDraftHtml', () => {
  it('escapes HTML and renders action badges', () => {
    const html = renderDraftHtml(draft, evidence)
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('class="action try"')
    expect(html).toContain('值得试')
  })
})
