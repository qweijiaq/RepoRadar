import type { DbPool } from './db.js'
import { decryptSecret, encryptSecret, isEncryptedBox, type EncryptedBox } from './secret-box.js'
import { requireAuthSecret } from './secret-key.js'

const SETTINGS_KEY = 'mail.smtp'

export interface MailConfig {
  host: string
  port: number
  secure: boolean
  user: string | null
  pass: string | null
  from: string
  source: 'env' | 'database'
  /** 环境变量 SMTP_URL 原始值，仅用于 nodemailer */
  url?: string
}

export interface MailConfigSummary {
  host: string
  port: number
  secure: boolean
  user: string | null
  from: string
  hasPassword: boolean
}

export interface MailConfigStatus {
  source: 'env' | 'database' | null
  summary: MailConfigSummary | null
  unreadable: boolean
}

export interface MailConfigInput {
  host: string
  port: number
  secure: boolean
  user?: string | null
  pass?: string | null
  from?: string | null
}

interface StoredMailConfig {
  host: string
  port: number
  secure: boolean
  user: string | null
  pass: EncryptedBox | null
  from: string
}

function passphrase(): string {
  return requireAuthSecret()
}

export function isValidMailAddress(value: string): boolean {
  const match = value.match(/<([^>]+)>/)
  const address = (match?.[1] ?? value).trim()
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address)
}

export function isValidMailHost(value: string): boolean {
  const host = value.trim()
  return host.length >= 3 && host.length <= 253 && /^[A-Za-z0-9.-]+$/.test(host)
}

export function isValidMailPort(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= 65535
}

export function parseEnvMailConfig(url: string, from?: string | null): MailConfig | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'smtp:' && parsed.protocol !== 'smtps:') return null
    const port = Number(parsed.port) || (parsed.protocol === 'smtps:' ? 465 : 587)
    const user = parsed.username ? decodeURIComponent(parsed.username) : null
    const pass = parsed.password ? decodeURIComponent(parsed.password) : null
    return {
      host: parsed.hostname,
      port,
      secure: parsed.protocol === 'smtps:' || port === 465,
      user,
      pass,
      from: from?.trim() || user || 'RepoRadar <radar@localhost>',
      source: 'env',
      url,
    }
  } catch {
    return null
  }
}

function summarize(config: Omit<MailConfig, 'source' | 'url' | 'pass'> & { pass?: string | null; hasPassword?: boolean }): MailConfigSummary {
  return {
    host: config.host,
    port: config.port,
    secure: config.secure,
    user: config.user,
    from: config.from,
    hasPassword: config.hasPassword ?? Boolean(config.pass),
  }
}

async function loadStored(pool: DbPool): Promise<StoredMailConfig | null> {
  const { rows } = await pool.query<{ value: StoredMailConfig }>(
    `SELECT value FROM app_settings WHERE key = $1`,
    [SETTINGS_KEY],
  )
  return rows[0]?.value ?? null
}

export async function resolveMailConfig(pool: DbPool): Promise<MailConfig | null> {
  const envUrl = process.env.SMTP_URL?.trim()
  if (envUrl) return parseEnvMailConfig(envUrl, process.env.MAIL_FROM)

  const stored = await loadStored(pool)
  if (!stored) return null
  let pass: string | null = null
  if (stored.pass) {
    if (!isEncryptedBox(stored.pass)) return null
    try {
      pass = decryptSecret(stored.pass, passphrase())
    } catch {
      return null
    }
  }
  if (stored.user && !pass) return null
  return {
    host: stored.host,
    port: stored.port,
    secure: stored.secure,
    user: stored.user,
    pass,
    from: stored.from,
    source: 'database',
  }
}

export async function loadMailStatus(pool: DbPool): Promise<MailConfigStatus> {
  const envUrl = process.env.SMTP_URL?.trim()
  if (envUrl) {
    const config = parseEnvMailConfig(envUrl, process.env.MAIL_FROM)
    return config
      ? { source: 'env', summary: summarize(config), unreadable: false }
      : { source: 'env', summary: null, unreadable: true }
  }

  const stored = await loadStored(pool)
  if (!stored) return { source: null, summary: null, unreadable: false }
  let readable = true
  if (stored.pass && !isEncryptedBox(stored.pass)) readable = false
  return {
    source: 'database',
    summary: summarize({
      host: stored.host,
      port: stored.port,
      secure: stored.secure,
      user: stored.user,
      from: stored.from,
      hasPassword: Boolean(stored.pass),
    }),
    unreadable: !readable,
  }
}

export async function saveMailConfig(pool: DbPool, input: MailConfigInput): Promise<void> {
  const host = input.host.trim()
  const port = Number(input.port)
  const user = input.user?.trim() || null
  const from = input.from?.trim() || user || ''
  if (!isValidMailHost(host)) throw new Error('SMTP 服务器地址格式不正确')
  if (!isValidMailPort(port)) throw new Error('SMTP 端口需要在 1-65535 之间')
  if (!from || !isValidMailAddress(from)) throw new Error('发件人邮箱格式不正确')
  if (user && !isValidMailAddress(user)) throw new Error('SMTP 用户名需要是邮箱地址')

  const existing = await loadStored(pool)
  let pass = existing?.pass ?? null
  if (input.pass?.trim()) pass = encryptSecret(input.pass.trim(), passphrase())
  if (user && !pass) throw new Error('请填写 SMTP 密码或授权码')

  const value: StoredMailConfig = { host, port, secure: Boolean(input.secure), user, pass, from }
  await pool.query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [SETTINGS_KEY, JSON.stringify(value)],
  )
}

export async function clearMailConfig(pool: DbPool): Promise<void> {
  await pool.query(`DELETE FROM app_settings WHERE key = $1`, [SETTINGS_KEY])
}

export function mailConfigLabel(status: MailConfigStatus): string {
  if (!status.summary) return status.unreadable ? '配置无法解密' : '未配置'
  return `${status.summary.host}:${status.summary.port}${status.summary.secure ? '（SSL）' : '（STARTTLS）'}`
}
