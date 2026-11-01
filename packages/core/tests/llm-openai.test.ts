import { createServer } from 'node:http'
import type { ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import { chatCompletion } from '../src/llm.js'
import { withLlmUsage } from '../src/usage.js'

const config = {
  apiKey: 'test-key',
  baseUrl: '',
  model: 'test-model',
  embeddingModel: 'unused',
  protocol: 'openai' as const,
}

async function withServer(
  handler: (body: Record<string, unknown>, response: ServerResponse) => void,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => handler(JSON.parse(body) as Record<string, unknown>, response))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  try {
    await run(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

describe('openai-compatible transport', () => {
  it('requests JSON mode and falls back when the provider rejects it', async () => {
    const bodies: Array<Record<string, unknown>> = []
    await withServer(
      (body, response) => {
        bodies.push(body)
        if (body.response_format) {
          sendJson(response, 400, { message: 'response_format is not supported by this model' })
          return
        }
        sendJson(response, 200, { choices: [{ message: { content: '{"ok":true}' } }] })
      },
      async (baseUrl) => {
        const result = await chatCompletion(
          { ...config, baseUrl },
          [{ role: 'user', content: 'return json' }],
          { jsonMode: true },
        )
        expect(result).toBe('{"ok":true}')
      },
    )

    expect(bodies).toHaveLength(2)
    expect(bodies[0]?.response_format).toEqual({ type: 'json_object' })
    expect(bodies[1]?.response_format).toBeUndefined()
  })

  it('records provider usage inside a usage collector', async () => {
    await withServer(
      (_body, response) => {
        sendJson(response, 200, {
          choices: [{ message: { content: 'ok' } }],
          usage: { prompt_tokens: 120, completion_tokens: 30 },
        })
      },
      async (baseUrl) => {
        let captured: unknown = null
        await withLlmUsage(
          () =>
            chatCompletion(
              { ...config, baseUrl, providerId: 'openai' },
              [{ role: 'user', content: 'hi' }],
            ),
          async (usage) => {
            captured = usage
          },
        )
        expect(captured).toEqual([
          {
            providerId: 'openai',
            model: 'test-model',
            promptTokens: 120,
            completionTokens: 30,
            latencyMs: expect.any(Number),
          },
        ])
      },
    )
  })

  it('falls back to reasoning_content when content is empty', async () => {
    await withServer(
      (_body, response) => {
        sendJson(response, 200, { choices: [{ message: { content: null, reasoning_content: '{"ok":true}' } }] })
      },
      async (baseUrl) => {
        await expect(
          chatCompletion({ ...config, baseUrl }, [{ role: 'user', content: 'hi' }]),
        ).resolves.toBe('{"ok":true}')
      },
    )
  })
})
