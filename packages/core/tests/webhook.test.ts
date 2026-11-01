import { describe, expect, it } from 'vitest'
import { parseGitHubWebhookPayload, webhookToActivity } from '../src/webhook.js'

describe('parseGitHubWebhookPayload', () => {
  it('accepts a valid webhook and rejects malformed payloads', () => {
    const payload = parseGitHubWebhookPayload({
      action: 'opened',
      repository: { full_name: 'me/app', id: 1 },
      sender: { login: 'alice' },
      issue: { number: 7, title: '登录失败', html_url: 'https://github.com/me/app/issues/7' },
    })
    expect(payload?.repository?.full_name).toBe('me/app')
    expect(payload?.issue?.number).toBe(7)
    expect(parseGitHubWebhookPayload(null)).toBeNull()
    expect(parseGitHubWebhookPayload('not-json')).toBeNull()
  })
})

describe('webhookToActivity', () => {
  it('maps watch and fork events', () => {
    const watch = webhookToActivity('watch', 'delivery-1', {
      repository: { full_name: 'me/app' },
      sender: { login: 'alice' },
    })
    expect(watch?.kind).toBe('github-star')
    expect(watch?.title).toContain('alice star 了 me/app')

    const fork = webhookToActivity('fork', 'delivery-2', {
      repository: { full_name: 'me/app' },
      sender: { login: 'bob' },
      forkee: { full_name: 'bob/app', html_url: 'https://github.com/bob/app' },
    })
    expect(fork?.kind).toBe('github-fork')
    expect(fork?.url).toBe('https://github.com/bob/app')
  })

  it('maps opened issues and pull requests but ignores other actions', () => {
    const issue = webhookToActivity('issues', 'delivery-3', {
      action: 'opened',
      repository: { full_name: 'me/app' },
      sender: { login: 'carol' },
      issue: { number: 7, title: '登录失败', html_url: 'https://github.com/me/app/issues/7' },
    })
    expect(issue?.kind).toBe('github-issue')
    expect(issue?.title).toContain('Issue #7')

    expect(
      webhookToActivity('issues', 'delivery-4', {
        action: 'closed',
        repository: { full_name: 'me/app' },
        sender: { login: 'carol' },
      }),
    ).toBeNull()
  })

  it('maps published releases', () => {
    const release = webhookToActivity('release', 'delivery-5', {
      action: 'published',
      repository: { full_name: 'me/app' },
      sender: { login: 'me' },
      release: { tag_name: 'v2.0.0', name: 'v2', html_url: 'https://github.com/me/app/releases/v2' },
    })
    expect(release?.kind).toBe('github-release')
    expect(release?.title).toContain('v2.0.0')
  })
})
