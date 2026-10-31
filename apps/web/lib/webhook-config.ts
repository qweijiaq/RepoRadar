import { decryptSecret, encryptSecret, isEncryptedBox, requireAuthSecret, type EncryptedBox } from '@repo-radar/core'
import { getPool } from './db'

const SETTINGS_KEY = 'webhook.github'

export interface GithubWebhookSecret {
  secret: string
  source: 'env' | 'database'
}

interface StoredWebhookSecret {
  secret: EncryptedBox
}

function passphrase(): string {
  return requireAuthSecret()
}

/**
 * 环境变量优先；否则读取页面保存的加密 secret。
 */
export async function resolveGithubWebhookSecret(): Promise<GithubWebhookSecret | null> {
  const env = process.env.GITHUB_WEBHOOK_SECRET?.trim()
  if (env) return { secret: env, source: 'env' }

  try {
    const { rows } = await getPool().query<{ value: StoredWebhookSecret }>(
      `SELECT value FROM app_settings WHERE key = $1`,
      [SETTINGS_KEY],
    )
    const stored = rows[0]?.value
    if (!stored || !isEncryptedBox(stored.secret)) return null
    return { secret: decryptSecret(stored.secret, passphrase()), source: 'database' }
  } catch (error) {
    console.error('[webhook] 读取 secret 失败：', error)
    return null
  }
}

export async function saveGithubWebhookSecret(secret: string): Promise<void> {
  const value: StoredWebhookSecret = { secret: encryptSecret(secret, passphrase()) }
  await getPool().query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [SETTINGS_KEY, JSON.stringify(value)],
  )
}

export async function clearGithubWebhookSecret(): Promise<void> {
  await getPool().query(`DELETE FROM app_settings WHERE key = $1`, [SETTINGS_KEY])
}

export function isValidWebhookSecret(secret: string): boolean {
  return secret.trim().length >= 8 && secret.trim().length <= 256
}
