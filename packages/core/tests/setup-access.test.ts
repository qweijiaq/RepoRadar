import { describe, expect, it } from 'vitest'
import { evaluateSetupAccess, isLocalSetupHost } from '../src/setup-access.js'

describe('setup access', () => {
  it('recognizes local hosts', () => {
    expect(isLocalSetupHost('localhost:3000')).toBe(true)
    expect(isLocalSetupHost('127.0.0.1:3000')).toBe(true)
    expect(isLocalSetupHost('[::1]:3000')).toBe(true)
    expect(isLocalSetupHost('radar.example.com')).toBe(false)
  })

  it('allows local bootstrap without a token', () => {
    expect(evaluateSetupAccess({ host: 'localhost:3000', setupToken: '', submittedToken: '' })).toBe('ok')
  })

  it('locks public bootstrap when no setup token is configured', () => {
    expect(evaluateSetupAccess({ host: 'radar.example.com', setupToken: '', submittedToken: '' })).toBe('locked')
  })

  it('requires the matching token on public hosts', () => {
    expect(
      evaluateSetupAccess({ host: 'radar.example.com', setupToken: 'secret', submittedToken: 'wrong' }),
    ).toBe('invalid-token')
    expect(
      evaluateSetupAccess({ host: 'radar.example.com', setupToken: 'secret', submittedToken: 'secret' }),
    ).toBe('ok')
  })
})
