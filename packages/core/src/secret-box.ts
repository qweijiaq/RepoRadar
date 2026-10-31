import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

export interface EncryptedBox {
  v: 1
  iv: string
  tag: string
  data: string
}

const SALT = 'repo-radar:secret-box:v1'

function deriveKey(passphrase: string): Buffer {
  return scryptSync(passphrase, SALT, 32)
}

export function encryptSecret(plaintext: string, passphrase: string): EncryptedBox {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', deriveKey(passphrase), iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return {
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: encrypted.toString('base64'),
  }
}

export function decryptSecret(box: EncryptedBox, passphrase: string): string {
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(passphrase), Buffer.from(box.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(box.tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(box.data, 'base64')), decipher.final()]).toString('utf8')
}

export function isEncryptedBox(value: unknown): value is EncryptedBox {
  if (typeof value !== 'object' || value === null) return false
  const box = value as Record<string, unknown>
  return box.v === 1 && typeof box.iv === 'string' && typeof box.tag === 'string' && typeof box.data === 'string'
}
