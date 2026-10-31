import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { chatCompletion } from '../src/llm.js'

describe('anthropic transport', () => {
  it('calls the messages API with the right headers and body', async () => {
    let captured: {
      url?: string
      headers?: Record<string, string | string[] | undefined>
      body?: Record<string, unknown>
    } = {}

    const server = createServer((request, response) => {
      let body = ''
      request.on('data', (chunk) => {
        body += chunk
      })
      request.on('end', () => {
        captured = { url: request.url, headers: request.headers, body: JSON.parse(body) as Record<string, unknown> }
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ content: [{ type: 'text', text: 'hello' }] }))
      })
    })

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0

    try {
      const result = await chatCompletion(
        {
          apiKey: 'test-key',
          baseUrl: `http://127.0.0.1:${port}`,
          model: 'claude-test',
          embeddingModel: 'unused',
          protocol: 'anthropic',
        },
        [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'hi' },
        ],
        { temperature: 0.4, maxTokens: 100 },
      )

      expect(result).toBe('hello')
      expect(captured.url).toBe('/v1/messages')
      expect(captured.headers?.['x-api-key']).toBe('test-key')
      expect(captured.headers?.['anthropic-version']).toBe('2023-06-01')
      expect(captured.body?.system).toBe('sys')
      expect(captured.body?.messages).toEqual([{ role: 'user', content: 'hi' }])
      expect(captured.body?.max_tokens).toBe(100)
      expect(captured.body?.temperature).toBe(0.4)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
