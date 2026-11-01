import { decryptSecret, encryptSecret, isEncryptedBox, type EncryptedBox } from './secret-box.js'
import { requireAuthSecret } from './secret-key.js'

function passphrase(): string {
  return requireAuthSecret()
}

export function encryptJobToken(token: string | null): EncryptedBox | null {
  if (!token) return null
  return encryptSecret(token, passphrase())
}

export function decryptJobToken(token: EncryptedBox | null | undefined): string | null {
  if (!token || !isEncryptedBox(token)) return null
  try {
    return decryptSecret(token, passphrase())
  } catch {
    return null
  }
}
