import { describe, expect, it } from 'vitest'
import { decryptSecret, encryptSecret, isEncryptedBox } from '../src/secret-box.js'

describe('secret-box', () => {
  it('round-trips a secret with the same passphrase', () => {
    const box = encryptSecret('super-secret-client-value', 'passphrase-1')
    expect(box.v).toBe(1)
    expect(isEncryptedBox(box)).toBe(true)
    expect(decryptSecret(box, 'passphrase-1')).toBe('super-secret-client-value')
  })

  it('produces a different ciphertext for each encryption', () => {
    const a = encryptSecret('same', 'pass')
    const b = encryptSecret('same', 'pass')
    expect(a.data).not.toBe(b.data)
  })

  it('fails to decrypt with the wrong passphrase', () => {
    const box = encryptSecret('secret', 'correct')
    expect(() => decryptSecret(box, 'wrong')).toThrow()
  })

  it('rejects malformed boxes', () => {
    expect(isEncryptedBox(null)).toBe(false)
    expect(isEncryptedBox({ v: 1 })).toBe(false)
    expect(isEncryptedBox({ v: 2, iv: 'a', tag: 'b', data: 'c' })).toBe(false)
  })
})
