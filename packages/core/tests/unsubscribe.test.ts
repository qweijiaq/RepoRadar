import { afterEach, describe, expect, it, vi } from 'vitest'
import { appendUnsubscribeFooter, createUnsubscribeToken, verifyUnsubscribeToken } from '../src/unsubscribe.js'

afterEach(() => vi.unstubAllEnvs())

describe('unsubscribe token', () => {
  it('round-trips a user id', () => {
    vi.stubEnv('AUTH_SECRET', 'test-secret')
    const token = createUnsubscribeToken(42)
    expect(verifyUnsubscribeToken(token)).toBe(42)
  })

  it('rejects tampered tokens', () => {
    vi.stubEnv('AUTH_SECRET', 'test-secret')
    const token = createUnsubscribeToken(42)
    expect(verifyUnsubscribeToken(`${token}x`)).toBeNull()
    expect(verifyUnsubscribeToken('42.invalid')).toBeNull()
    expect(verifyUnsubscribeToken('not-a-token')).toBeNull()
  })

  it('appends a footer to html and text', () => {
    vi.stubEnv('AUTH_SECRET', 'test-secret')
    const result = appendUnsubscribeFooter('<html><body>hi</body></html>', 'hi', 7, 'https://radar.example.com')
    expect(result.html).toContain('/unsubscribe?token=')
    expect(result.text).toContain('退订')
  })
})
