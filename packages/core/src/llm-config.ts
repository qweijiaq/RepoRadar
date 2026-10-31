import type { LlmConfig } from './config.js'
import type { DbPool } from './db.js'
import { findLlmProvider, type LlmProviderInfo } from './providers.js'
import { decryptSecret, encryptSecret, isEncryptedBox, type EncryptedBox } from './secret-box.js'
import { requireAuthSecret } from './secret-key.js'

const SETTINGS_KEY = 'llm.config'

export interface StoredLlmInput {
  providerId: string
  model: string
  apiKey: string
  baseUrl?: string
}

export interface LlmConfigSummary {
  providerId: string
  model: string
  baseUrl: string
  keyHint?: string
}

export type StoredLlmState = 'missing' | 'ok' | 'unreadable'

export interface StoredLlmStatus {
  state: StoredLlmState
  summary: LlmConfigSummary | null
}

interface StoredLlmConfig {
  providerId: string
  model: string
  baseUrl: string
  apiKey: EncryptedBox
}

function passphrase(): string {
  return requireAuthSecret()
}

function normalizeBaseUrl(provider: LlmProviderInfo, baseUrl?: string): string {
  return (baseUrl?.trim() || provider.baseUrl).replace(/\/+$/, '')
}

export function buildLlmConfig(input: StoredLlmInput): LlmConfig {
  const provider = findLlmProvider(input.providerId)
  if (!provider) throw new Error(`未知的模型服务商：${input.providerId}`)
  const model = input.model.trim()
  if (!model) throw new Error('模型不能为空')

  return {
    apiKey: input.apiKey,
    baseUrl: normalizeBaseUrl(provider, input.baseUrl),
    model,
    embeddingModel: process.env.EMBEDDING_MODEL?.trim() || 'text-embedding-3-small',
    protocol: provider.protocol,
    providerId: provider.id,
  }
}

export async function saveStoredLlmConfig(pool: DbPool, input: StoredLlmInput): Promise<void> {
  const config = buildLlmConfig(input)
  const value: StoredLlmConfig = {
    providerId: input.providerId,
    model: config.model,
    baseUrl: config.baseUrl,
    apiKey: encryptSecret(input.apiKey, passphrase()),
  }
  await pool.query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [SETTINGS_KEY, JSON.stringify(value)],
  )
}

export async function loadStoredLlmConfig(pool: DbPool): Promise<LlmConfig | null> {
  try {
    const { rows } = await pool.query<{ value: StoredLlmConfig }>(
      `SELECT value FROM app_settings WHERE key = $1`,
      [SETTINGS_KEY],
    )
    const stored = rows[0]?.value
    if (!stored || !isEncryptedBox(stored.apiKey)) return null

    return buildLlmConfig({
      providerId: stored.providerId,
      model: stored.model,
      baseUrl: stored.baseUrl,
      apiKey: decryptSecret(stored.apiKey, passphrase()),
    })
  } catch (error) {
    console.error('[llm] 读取模型配置失败：', error)
    return null
  }
}

export async function loadStoredLlmSummary(pool: DbPool): Promise<LlmConfigSummary | null> {
  return (await loadStoredLlmStatus(pool)).summary
}

export async function loadStoredLlmStatus(pool: DbPool): Promise<StoredLlmStatus> {
  try {
    const { rows } = await pool.query<{ value: StoredLlmConfig }>(
      `SELECT value FROM app_settings WHERE key = $1`,
      [SETTINGS_KEY],
    )
    const stored = rows[0]?.value
    if (!stored) return { state: 'missing', summary: null }
    if (!isEncryptedBox(stored.apiKey)) return { state: 'unreadable', summary: null }

    const provider = findLlmProvider(stored.providerId)
    if (!provider) return { state: 'unreadable', summary: null }

    let apiKey: string
    try {
      apiKey = decryptSecret(stored.apiKey, passphrase())
    } catch {
      // 行还在但解不开：通常是 AUTH_SECRET 变了，需要用户重新输入一次
      return { state: 'unreadable', summary: null }
    }

    return {
      state: 'ok',
      summary: {
        providerId: provider.id,
        model: stored.model,
        baseUrl: stored.baseUrl,
        keyHint: apiKey.length >= 4 ? apiKey.slice(-4) : undefined,
      },
    }
  } catch (error) {
    console.error('[llm] 读取模型配置失败：', error)
    return { state: 'unreadable', summary: null }
  }
}

export async function clearStoredLlmConfig(pool: DbPool): Promise<void> {
  await pool.query(`DELETE FROM app_settings WHERE key = $1`, [SETTINGS_KEY])
}

export function envLlmSummary(env: NodeJS.ProcessEnv = process.env): LlmConfigSummary | null {
  const apiKey = env.LLM_API_KEY?.trim()
  if (!apiKey) return null
  const provider = findLlmProvider(env.LLM_PROVIDER?.trim() || 'openai') ?? findLlmProvider('openai')
  return {
    providerId: provider?.id ?? 'openai',
    model: env.LLM_MODEL?.trim() || provider?.defaultModel || '',
    baseUrl: (env.LLM_BASE_URL?.trim() || provider?.baseUrl || '').replace(/\/+$/, ''),
  }
}
