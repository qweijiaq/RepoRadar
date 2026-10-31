import { decryptSecret, encryptSecret, isEncryptedBox, type EncryptedBox } from './secret-box.js'
import { requireAuthSecret } from './secret-key.js'
import type { DbPool } from './db.js'

function passphrase(): string {
  return requireAuthSecret()
}

export async function saveUserGithubToken(pool: DbPool, userId: number, token: string): Promise<void> {
  if (!token.trim()) return
  const box = encryptSecret(token, passphrase())
  await pool.query(
    `INSERT INTO github_tokens (user_id, token, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (user_id) DO UPDATE SET token = EXCLUDED.token, updated_at = now()`,
    [userId, JSON.stringify(box)],
  )
}

export async function loadUserGithubToken(pool: DbPool, userId: number): Promise<string | null> {
  const { rows } = await pool.query<{ token: EncryptedBox }>(
    `SELECT token FROM github_tokens WHERE user_id = $1`,
    [userId],
  )
  const box = rows[0]?.token
  if (!box || !isEncryptedBox(box)) return null
  try {
    return decryptSecret(box, passphrase())
  } catch {
    return null
  }
}

export interface UserGithubToken {
  userId: number
  login: string
  token: string
}

export async function listUserGithubTokens(pool: DbPool): Promise<UserGithubToken[]> {
  const { rows } = await pool.query<{ user_id: string; login: string; token: EncryptedBox }>(
    `SELECT t.user_id, u.login, t.token
     FROM github_tokens t
     JOIN users u ON u.id = t.user_id
     ORDER BY t.updated_at DESC`,
  )
  const result: UserGithubToken[] = []
  for (const row of rows) {
    if (!isEncryptedBox(row.token)) continue
    try {
      result.push({ userId: Number(row.user_id), login: row.login, token: decryptSecret(row.token, passphrase()) })
    } catch {
      // 无法解密的 token 跳过（AUTH_SECRET 可能已更换）
    }
  }
  return result
}

export async function clearUserGithubToken(pool: DbPool, userId: number): Promise<void> {
  await pool.query(`DELETE FROM github_tokens WHERE user_id = $1`, [userId])
}
