import type { LlmProtocol } from './providers.js'

export const DEFAULT_TOPICS = ['ai-agents', 'llm', 'developer-tools', 'mcp', 'cli']

export interface LlmConfig {
  apiKey: string
  baseUrl: string
  model: string
  embeddingModel: string
  protocol?: LlmProtocol
  providerId?: string
}

export interface SearchConfig {
  topics: string[]
  days: number
  delayMs: number
}

export interface AppConfig {
  databaseUrl: string
  githubToken: string | null
  llm: LlmConfig | null
  search: SearchConfig
}

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function toInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const apiKey = clean(env.LLM_API_KEY)
  const topics = (clean(env.RADAR_TOPICS) ?? DEFAULT_TOPICS.join(','))
    .split(',')
    .map((topic) => topic.trim())
    .filter(Boolean)

  return {
    databaseUrl: clean(env.DATABASE_URL) ?? 'postgres://radar:radar@localhost:5433/radar',
    githubToken: clean(env.GITHUB_TOKEN) ?? clean(env.GH_TOKEN),
    llm: apiKey
      ? {
          apiKey,
          baseUrl: clean(env.LLM_BASE_URL) ?? 'https://api.openai.com/v1',
          model: clean(env.LLM_MODEL) ?? 'gpt-4o-mini',
          embeddingModel: clean(env.EMBEDDING_MODEL) ?? 'text-embedding-3-small',
          protocol: env.LLM_PROTOCOL?.trim() === 'anthropic' ? 'anthropic' : 'openai',
          providerId: clean(env.LLM_PROVIDER) ?? undefined,
        }
      : null,
    search: {
      topics,
      days: toInt(env.RADAR_DAYS, 30),
      delayMs: toInt(env.RADAR_DELAY_MS, 2200),
    },
  }
}
