import { describe, expect, it } from 'vitest'
import { redactJobPayload } from '../src/account.js'

describe('redactJobPayload', () => {
  it('removes the encrypted GitHub token from exported jobs', () => {
    const payload = {
      repo: 'acme/widget',
      token: { v: 1, iv: 'iv', tag: 'tag', data: 'data' },
      issueNumber: 7,
    }
    expect(redactJobPayload(payload)).toEqual({ repo: 'acme/widget', issueNumber: 7 })
  })

  it('handles empty payloads', () => {
    expect(redactJobPayload(null)).toEqual({})
    expect(redactJobPayload('not-an-object')).toEqual({})
  })
})
