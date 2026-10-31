import { decryptSecret, encryptSecret, isEncryptedBox, requireAuthSecret, type EncryptedBox } from '@repo-radar/core'
import { getPool } from './db'

const SETTINGS_KEY = 'oauth.github'

export interface GithubOAuthCredentials {
  clientId: string
  clientSecret: string
  source: 'env' | 'database'
}

interface StoredOAuthConfig {
  clientId: string
  secret: EncryptedBox
}

let cached: GithubOAuthCredentials | null = null

function envCredentials(): GithubOAuthCredentials | null {
  const clientId = process.env.AUTH_GITHUB_ID?.trim()
  const clientSecret = process.env.AUTH_GITHUB_SECRET?.trim()
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret, source: 'env' }
}

function passphrase(): string {
  return requireAuthSecret()
}

export async function resolveGithubCredentials(): Promise<GithubOAuthCredentials | null> {
  const fromEnv = envCredentials()
  if (fromEnv) return fromEnv
  if (cached) return cached

  try {
    const { rows } = await getPool().query<{ value: StoredOAuthConfig }>(
      `SELECT value FROM app_settings WHERE key = $1`,
      [SETTINGS_KEY],
    )
    const stored = rows[0]?.value
    if (!stored || typeof stored.clientId !== 'string' || !isEncryptedBox(stored.secret)) return null

    cached = {
      clientId: stored.clientId,
      clientSecret: decryptSecret(stored.secret, passphrase()),
      source: 'database',
    }
    return cached
  } catch (error) {
    console.error('[oauth] 读取 OAuth 配置失败：', error)
    return null
  }
}

export async function saveGithubCredentials(clientId: string, clientSecret: string): Promise<void> {
  const value: StoredOAuthConfig = {
    clientId,
    secret: encryptSecret(clientSecret, passphrase()),
  }
  await getPool().query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [SETTINGS_KEY, JSON.stringify(value)],
  )
  cached = { clientId, clientSecret, source: 'database' }
}

export async function clearGithubCredentials(): Promise<void> {
  await getPool().query(`DELETE FROM app_settings WHERE key = $1`, [SETTINGS_KEY])
  cached = null
}

export function maskClientId(clientId: string): string {
  return clientId.length <= 10 ? clientId : `${clientId.slice(0, 6)}…${clientId.slice(-4)}`
}
