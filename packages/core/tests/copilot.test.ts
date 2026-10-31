import { describe, expect, it } from 'vitest'
import { buildCopilotMessages, type CopilotContext, type CopilotMessage } from '../src/copilot.js'

const context: CopilotContext = {
  login: 'me',
  profile: {
    topics: [{ topic: 'ai-agent', weight: 1 }],
    languages: [{ language: 'TypeScript', weight: 1 }],
    starredCount: 36,
  },
  projects: [
    {
      repo: 'me/app',
      description: '一个 CLI',
      language: 'TypeScript',
      topics: ['ai-agent'],
    },
  ],
  maintainer: {
    projects: [
      {
        repo: 'me/app',
        healthScore: 68,
        summary: '缺 CI',
        risks: ['没有 CI'],
        actions: ['补 CI'],
        dependencies: [{ name: 'next', current: '^15', latest: '16', risk: 'major' }],
        items: [{ kind: 'issue', number: 7, title: '登录失败', priority: 'now', reason: '影响用户' }],
      },
    ],
  },
  integration: null,
  watch: [],
  history: [],
}

describe('buildCopilotMessages', () => {
  it('includes context, history and the current question', () => {
    const history: CopilotMessage[] = [
      {
        id: 1,
        role: 'user',
        content: '之前的问题',
        model: null,
        providerId: null,
        createdAt: '2026-10-31T00:00:00Z',
      },
      {
        id: 2,
        role: 'assistant',
        content: '之前的回答',
        model: 'deepseek-flash',
        providerId: 'deepseek',
        createdAt: '2026-10-31T00:00:01Z',
      },
    ]
    const messages = buildCopilotMessages(context, history, '这周先做什么？')

    expect(messages[0]?.role).toBe('system')
    expect(messages[0]?.content).toContain('AI 项目搭档')
    expect(messages[0]?.content).toContain('me/app')
    expect(messages.some((message) => message.role === 'assistant' && message.content === '之前的回答')).toBe(true)
    expect(messages.at(-1)).toEqual({ role: 'user', content: '这周先做什么？' })
  })
})
