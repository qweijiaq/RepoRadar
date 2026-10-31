import { afterEach, describe, expect, it, vi } from 'vitest'
import { requireAuthSecret } from '../src/secret-key.js'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('requireAuthSecret', () => {
  it('returns the configured secret', () => {
    vi.stubEnv('AUTH_SECRET', 'configured-secret')
    vi.stubEnv('NODE_ENV', 'production')
    expect(requireAuthSecret()).toBe('configured-secret')
  })

  it('fails closed in production without a secret', () => {
    vi.stubEnv('AUTH_SECRET', '')
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => requireAuthSecret()).toThrow(/AUTH_SECRET/)
  })

  it('allows a development fallback only outside production', () => {
    vi.stubEnv('AUTH_SECRET', '')
    vi.stubEnv('NODE_ENV', 'development')
    expect(requireAuthSecret()).toBe('repo-radar-insecure-dev-secret')
  })
})
