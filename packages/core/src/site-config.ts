import type { DbPool } from './db.js'

const SETTINGS_KEY = 'site.baseUrl'
const DEFAULT_BASE_URL = 'http://localhost:3000'

export interface BaseUrlStatus {
  url: string
  source: 'env' | 'database' | 'default'
}

export function normalizeBaseUrl(value: string): string | null {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!trimmed) return null
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    if (!parsed.hostname) return null
    return trimmed
  } catch {
    return null
  }
}

export async function resolveBaseUrlStatus(pool: DbPool): Promise<BaseUrlStatus> {
  const env = process.env.RADAR_BASE_URL?.trim()
  if (env) {
    const normalized = normalizeBaseUrl(env)
    if (normalized) return { url: normalized, source: 'env' }
  }
  const { rows } = await pool.query<{ value: { url?: string } }>(
    `SELECT value FROM app_settings WHERE key = $1`,
    [SETTINGS_KEY],
  )
  const stored = rows[0]?.value?.url
  const normalized = stored ? normalizeBaseUrl(stored) : null
  if (normalized) return { url: normalized, source: 'database' }
  return { url: DEFAULT_BASE_URL, source: 'default' }
}

export async function resolveBaseUrl(pool: DbPool): Promise<string> {
  return (await resolveBaseUrlStatus(pool)).url
}

export async function saveBaseUrl(pool: DbPool, value: string): Promise<void> {
  const normalized = normalizeBaseUrl(value)
  if (!normalized) throw new Error('站点地址需要是 http/https 开头的完整地址')
  await pool.query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [SETTINGS_KEY, JSON.stringify({ url: normalized })],
  )
}

export async function clearBaseUrl(pool: DbPool): Promise<void> {
  await pool.query(`DELETE FROM app_settings WHERE key = $1`, [SETTINGS_KEY])
}
