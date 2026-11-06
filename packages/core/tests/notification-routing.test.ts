import { describe, expect, it } from 'vitest'
import {
  DEFAULT_NOTIFICATION_PREFS,
  notificationCategory,
  notificationChannelEnabled,
} from '../src/users.js'

describe('notification routing', () => {
  it('maps GitHub and AI notification kinds to categories', () => {
    expect(notificationCategory('github-star')).toBe('githubStar')
    expect(notificationCategory('github-pr')).toBe('githubPull')
    expect(notificationCategory('release')).toBe('release')
    expect(notificationCategory('job')).toBe('ai')
    expect(notificationCategory('maintainer')).toBe('ai')
    expect(notificationCategory('unknown-kind')).toBe('system')
  })

  it('keeps legacy behavior when no category filter is configured', () => {
    const prefs = { ...DEFAULT_NOTIFICATION_PREFS, emailNotifications: true, pushNotifications: true }
    expect(notificationChannelEnabled(prefs, 'githubStar', 'email')).toBe(true)
    expect(notificationChannelEnabled(prefs, 'release', 'push')).toBe(true)
  })

  it('respects the category filter and master switch', () => {
    const prefs = {
      ...DEFAULT_NOTIFICATION_PREFS,
      emailNotifications: true,
      pushNotifications: true,
      emailKinds: ['release' as const],
      pushKinds: ['githubStar' as const],
    }
    expect(notificationChannelEnabled(prefs, 'release', 'email')).toBe(true)
    expect(notificationChannelEnabled(prefs, 'githubStar', 'email')).toBe(false)
    expect(notificationChannelEnabled(prefs, 'githubStar', 'push')).toBe(true)
    expect(notificationChannelEnabled(prefs, 'release', 'push')).toBe(false)
    expect(
      notificationChannelEnabled({ ...prefs, emailNotifications: false }, 'release', 'email'),
    ).toBe(false)
  })
})
