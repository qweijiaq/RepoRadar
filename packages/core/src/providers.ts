import { LLM_PROVIDER_DATA } from './provider-data.js'

export type LlmProtocol = 'openai' | 'anthropic'

export interface LlmModelInfo {
  id: string
  label: string
}

export interface LlmBaseUrlOption {
  label: string
  url: string
}

export interface LlmProviderInfo {
  id: string
  name: string
  envKey: string
  keyUrl: string
  protocol: LlmProtocol
  baseUrl: string
  defaultModel: string
  models: LlmModelInfo[]
  baseUrlOptions?: LlmBaseUrlOption[]
}

export const LLM_PROVIDERS: LlmProviderInfo[] = LLM_PROVIDER_DATA

export function findLlmProvider(providerId: string): LlmProviderInfo | null {
  return LLM_PROVIDERS.find((provider) => provider.id === providerId) ?? null
}

export function findLlmModel(providerId: string, modelId: string): LlmModelInfo | null {
  return findLlmProvider(providerId)?.models.find((model) => model.id === modelId) ?? null
}
