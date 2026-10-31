import webpush from 'web-push'
import {
  decryptSecret,
  encryptSecret,
  isEncryptedBox,
  type DbPool,
  requireAuthSecret,
  type EncryptedBox,
} from '@repo-radar/core'

const SETTINGS_KEY = 'push.vapid'

interface VapidKeys {
  publicKey: string
  privateKey: string
}

function passphrase(): string {
  return requireAuthSecret()
}

function readKeys(value: unknown): VapidKeys | null {
  if (!isEncryptedBox(value)) return null
  try {
    const parsed = JSON.parse(decryptSecret(value, passphrase())) as Partial<VapidKeys>
    if (typeof parsed.publicKey === 'string' && typeof parsed.privateKey === 'string') {
      return { publicKey: parsed.publicKey, privateKey: parsed.privateKey }
    }
  } catch {
    // 密钥无法解密时重新生成，旧订阅会失效
  }
  return null
}

async function loadStoredKeys(pool: DbPool): Promise<VapidKeys | null> {
  const { rows } = await pool.query<{ value: EncryptedBox }>(
    `SELECT value FROM app_settings WHERE key = $1`,
    [SETTINGS_KEY],
  )
  return rows[0] ? readKeys(rows[0].value) : null
}

export async function resolveVapidKeys(pool: DbPool): Promise<VapidKeys> {
  const existing = await loadStoredKeys(pool)
  if (existing) return existing
  const generated = webpush.generateVAPIDKeys()
  const box = encryptSecret(JSON.stringify(generated), passphrase())
  await pool.query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO NOTHING`,
    [SETTINGS_KEY, JSON.stringify(box)],
  )
  const stored = await loadStoredKeys(pool)
  return stored ?? generated
}

export async function getVapidPublicKey(pool: DbPool): Promise<string> {
  return (await resolveVapidKeys(pool)).publicKey
}

export interface PushSubscriptionInput {
  endpoint: string
  p256dh: string
  auth: string
  userAgent?: string | null
}

export function isValidPushSubscription(input: unknown): input is PushSubscriptionInput {
  if (!input || typeof input !== 'object') return false
  const value = input as Record<string, unknown>
  return (
    typeof value.endpoint === 'string' &&
    value.endpoint.startsWith('https://') &&
    value.endpoint.length <= 2048 &&
    typeof value.p256dh === 'string' &&
    value.p256dh.length > 0 &&
    typeof value.auth === 'string' &&
    value.auth.length > 0
  )
}

export async function savePushSubscription(
  pool: DbPool,
  userId: number,
  input: PushSubscriptionInput,
): Promise<void> {
  await pool.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE SET
       user_id = EXCLUDED.user_id,
       p256dh = EXCLUDED.p256dh,
       auth = EXCLUDED.auth,
       user_agent = EXCLUDED.user_agent`,
    [userId, input.endpoint, input.p256dh, input.auth, input.userAgent ?? null],
  )
}

export async function deletePushSubscription(pool: DbPool, userId: number, endpoint: string): Promise<void> {
  await pool.query(`DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2`, [userId, endpoint])
}

export async function countPushSubscriptions(pool: DbPool, userId: number): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT count(*) FROM push_subscriptions WHERE user_id = $1`,
    [userId],
  )
  return Number(rows[0]?.count ?? 0)
}

interface PushRow {
  endpoint: string
  p256dh: string
  auth: string
}

export async function sendPushToUser(
  pool: DbPool,
  userId: number,
  payload: { title: string; body?: string | null; url?: string | null },
): Promise<{ sent: number; removed: number }> {
  const { rows } = await pool.query<PushRow>(
    `SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1`,
    [userId],
  )
  if (rows.length === 0) return { sent: 0, removed: 0 }

  const keys = await resolveVapidKeys(pool)
  webpush.setVapidDetails(
    process.env.PUSH_CONTACT?.trim() || 'mailto:radar@localhost',
    keys.publicKey,
    keys.privateKey,
  )

  let sent = 0
  let removed = 0
  let lastError: string | null = null

  for (const row of rows) {
    try {
      await webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        JSON.stringify({
          title: payload.title,
          body: payload.body ?? '',
          url: payload.url ?? '/inbox',
        }),
        { TTL: 3600, timeout: 10_000 },
      )
      sent += 1
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode
      if (statusCode === 404 || statusCode === 410) {
        await pool.query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [row.endpoint])
        removed += 1
      } else {
        const code = (error as { code?: string }).code
        lastError =
          (error instanceof Error && error.message) ||
          code ||
          (error instanceof AggregateError ? '推送服务连接失败' : String(error))
      }
    }
  }

  if (sent === 0 && removed === 0) throw new Error(lastError ?? '推送发送失败')
  return { sent, removed }
}
