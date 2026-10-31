import { describe, expect, it } from 'vitest'
import {
  isValidMailAddress,
  isValidMailHost,
  isValidMailPort,
  parseEnvMailConfig,
} from '../src/mail-config.js'
import { normalizeBaseUrl } from '../src/site-config.js'

describe('parseEnvMailConfig', () => {
  it('parses an smtp URL and keeps the sender', () => {
    const config = parseEnvMailConfig('smtp://user@qq.com:auth-code@smtp.qq.com:465', 'RepoRadar <user@qq.com>')
    expect(config?.host).toBe('smtp.qq.com')
    expect(config?.port).toBe(465)
    expect(config?.secure).toBe(true)
    expect(config?.user).toBe('user@qq.com')
    expect(config?.pass).toBe('auth-code')
    expect(config?.from).toBe('RepoRadar <user@qq.com>')
    expect(config?.source).toBe('env')
  })

  it('defaults smtps to port 465 and smtp to 587', () => {
    expect(parseEnvMailConfig('smtps://user:pass@smtp.example.com')?.port).toBe(465)
    expect(parseEnvMailConfig('smtp://user:pass@smtp.example.com')?.port).toBe(587)
  })

  it('rejects invalid URLs and non-SMTP protocols', () => {
    expect(parseEnvMailConfig('not a url')).toBeNull()
    expect(parseEnvMailConfig('https://example.com')).toBeNull()
  })
})

describe('mail validation', () => {
  it('accepts QQ addresses and display names', () => {
    expect(isValidMailAddress('you@qq.com')).toBe(true)
    expect(isValidMailAddress('RepoRadar <radar@qq.com>')).toBe(true)
    expect(isValidMailAddress('bad@')).toBe(false)
  })

  it('validates hosts and ports', () => {
    expect(isValidMailHost('smtp.qq.com')).toBe(true)
    expect(isValidMailHost('bad host')).toBe(false)
    expect(isValidMailPort(465)).toBe(true)
    expect(isValidMailPort(0)).toBe(false)
  })
})

describe('normalizeBaseUrl', () => {
  it('keeps http/https URLs and strips trailing slashes', () => {
    expect(normalizeBaseUrl('https://radar.example.com/')).toBe('https://radar.example.com')
    expect(normalizeBaseUrl('http://localhost:3000')).toBe('http://localhost:3000')
  })

  it('rejects non-http values', () => {
    expect(normalizeBaseUrl('radar.example.com')).toBeNull()
    expect(normalizeBaseUrl('ftp://example.com')).toBeNull()
  })
})
