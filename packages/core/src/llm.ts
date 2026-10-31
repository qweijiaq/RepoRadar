import type { LlmConfig } from './config.js'
import { recordLlmUsage } from './usage.js'

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatOptions {
  temperature?: number
  maxTokens?: number
  /** 要求 OpenAI 兼容接口返回 JSON 对象；不支持时会自动降级重试 */
  jsonMode?: boolean
}

export async function chatCompletion(
  config: LlmConfig,
  messages: ChatMessage[],
  options: ChatOptions = {},
): Promise<string> {
  if (config.protocol === 'anthropic') {
    return anthropicChatCompletion(config, messages, options)
  }
  return openAiChatCompletion(config, messages, options)
}

async function openAiChatCompletion(
  config: LlmConfig,
  messages: ChatMessage[],
  options: ChatOptions,
  useJsonMode = true,
): Promise<string> {
  const startedAt = Date.now()
  const response = await fetch(`${trimSlash(config.baseUrl)}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: options.temperature ?? 0.2,
      ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
      ...(options.jsonMode && useJsonMode ? { response_format: { type: 'json_object' } } : {}),
    }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500)
    // 部分 OpenAI 兼容服务不支持 response_format，降级后重试一次
    if (
      options.jsonMode &&
      useJsonMode &&
      (response.status === 400 || response.status === 422) &&
      /response_format|json_object|json mode/i.test(detail)
    ) {
      return openAiChatCompletion(config, messages, options, false)
    }
    throw new Error(`LLM API ${response.status}: ${detail.slice(0, 300)}`)
  }
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null; reasoning_content?: string | null } }>
    usage?: { prompt_tokens?: number; completion_tokens?: number }
  }
  const message = data.choices?.[0]?.message
  const content = message?.content || message?.reasoning_content
  if (!content) throw new Error('LLM 返回内容为空')
  recordLlmUsage({
    providerId: config.providerId ?? null,
    model: config.model,
    promptTokens: data.usage?.prompt_tokens ?? 0,
    completionTokens: data.usage?.completion_tokens ?? 0,
    latencyMs: Date.now() - startedAt,
  })
  return content
}

async function anthropicChatCompletion(
  config: LlmConfig,
  messages: ChatMessage[],
  options: ChatOptions,
): Promise<string> {
  const base = trimSlash(config.baseUrl)
  const url = base.endsWith('/v1') ? `${base}/messages` : `${base}/v1/messages`
  const system = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n')

  const startedAt = Date.now()
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature ?? 0.2,
      ...(system ? { system } : {}),
      messages: messages
        .filter((message) => message.role !== 'system')
        .map((message) => ({ role: message.role, content: message.content })),
    }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!response.ok) {
    throw new Error(`LLM API ${response.status}: ${(await response.text()).slice(0, 300)}`)
  }
  const data = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>
    usage?: { input_tokens?: number; output_tokens?: number }
  }
  const content = (data.content ?? [])
    .filter((block) => block.type === 'text' && block.text)
    .map((block) => block.text)
    .join('\n')
  if (!content) throw new Error('LLM 返回内容为空')
  recordLlmUsage({
    providerId: config.providerId ?? 'anthropic',
    model: config.model,
    promptTokens: data.usage?.input_tokens ?? 0,
    completionTokens: data.usage?.output_tokens ?? 0,
    latencyMs: Date.now() - startedAt,
  })
  return content
}

export async function embedText(config: LlmConfig, input: string): Promise<number[] | null> {
  if (config.protocol === 'anthropic') return null
  try {
    const response = await fetch(`${trimSlash(config.baseUrl)}/embeddings`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ model: config.embeddingModel, input }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) return null
    const data = (await response.json()) as { data?: Array<{ embedding?: number[] }> }
    return data.data?.[0]?.embedding ?? null
  } catch {
    return null
  }
}
