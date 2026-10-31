import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import type { IssueEvidence } from '../src/issue.js'
import {
  generateIssueDraft,
  groundIssueDraft,
  parseIssueDraft,
  type IssueDraft,
} from '../src/narrative.js'

function makeEvidence(): IssueEvidence {
  return {
    userName: 'demo',
    date: new Date('2026-10-30T00:00:00Z'),
    windowDays: 7,
    totalCandidates: 10,
    profile: {
      starredCount: 5,
      topTopics: [{ topic: 'cli', weight: 1 }],
      topLanguages: [{ language: 'TypeScript', weight: 1 }],
    },
    releases: [
      {
        repoFullName: 'acme/tool',
        tag: 'v1.2.0',
        name: 'Tool 1.2',
        url: 'https://github.com/acme/tool/releases/tag/v1.2.0',
        publishedAt: '2026-10-28T00:00:00Z',
        isNew: true,
        isStarred: true,
      },
      {
        repoFullName: 'acme/other',
        tag: 'v0.1.0',
        name: null,
        url: null,
        publishedAt: '2026-10-27T00:00:00Z',
        isNew: true,
        isStarred: false,
      },
    ],
    groups: [
      {
        topic: 'cli',
        repos: [
          {
            fullName: 'acme/tool',
            htmlUrl: 'https://github.com/acme/tool',
            stars: 1234,
            language: 'TypeScript',
            topics: ['cli', 'developer-tools'],
            summary: '一个 CLI 工具',
            reason: '近期活跃',
            score: 0.8,
            pushedAt: '2026-10-29T00:00:00Z',
            verifyStatus: null,
          },
        ],
      },
    ],
    rising: [],
  }
}

const cannedDraft: IssueDraft = {
  title: '终端工具本周的三个变化',
  summary: ['第一条结论。', '第二条结论。'],
  themes: [
    {
      title: '终端工具',
      judgment: '终端工具在加速迭代。',
      items: [
        {
          repo: 'acme/tool',
          name: 'Tool',
          change: '发布 v1.2.0',
          evidence: 'v1.2.0，10-28 发布，1234 stars',
          relevance: '和你的 CLI 工作流相关',
          action: 'try',
          cost: '估计 2 分钟',
        },
        {
          repo: 'acme/unknown',
          name: 'Fake',
          change: '编造的变化',
          evidence: '无',
          relevance: '无',
          action: 'watch',
        },
      ],
    },
  ],
  ignore: [
    { repo: 'acme/other', reason: '与你的工作流无关' },
    { repo: 'acme/ghost', reason: '编造的项目' },
  ],
  next: ['下期选题一'],
}

describe('parseIssueDraft', () => {
  it('parses JSON wrapped in a code fence', () => {
    const raw = '```json\n' + JSON.stringify(cannedDraft) + '\n```'
    expect(parseIssueDraft(raw).title).toBe(cannedDraft.title)
  })

  it('rejects non-JSON output', () => {
    expect(() => parseIssueDraft('这不是 JSON')).toThrow()
  })

  it('rejects JSON that does not match the schema', () => {
    expect(() => parseIssueDraft('{"title":"x"}')).toThrow()
  })
})

describe('groundIssueDraft', () => {
  it('drops items and ignore entries for unknown repos', () => {
    const grounded = groundIssueDraft(cannedDraft, makeEvidence())
    expect(grounded.themes).toHaveLength(1)
    expect(grounded.themes[0]?.items.map((item) => item.repo)).toEqual(['acme/tool'])
    expect(grounded.ignore.map((entry) => entry.repo)).toEqual(['acme/other'])
  })
})

describe('generateIssueDraft', () => {
  it('calls an OpenAI-compatible endpoint and grounds the result', async () => {
    const server = createServer((request, response) => {
      request.on('data', () => {})
      request.on('end', () => {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(cannedDraft) } }] }))
      })
    })

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0

    try {
      const draft = await generateIssueDraft(makeEvidence(), {
        apiKey: 'test-key',
        baseUrl: `http://127.0.0.1:${port}/v1`,
        model: 'mock-model',
        embeddingModel: 'mock-embedding',
      })
      expect(draft.title).toBe(cannedDraft.title)
      expect(draft.themes[0]?.items).toHaveLength(1)
      expect(draft.ignore).toHaveLength(1)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
