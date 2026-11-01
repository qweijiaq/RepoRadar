import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateIntegrationTrial, type IntegrationTrialInput } from '../src/integrations.js'

const llm = {
  apiKey: 'test-key',
  baseUrl: 'https://example.invalid/v1',
  model: 'test-model',
  embeddingModel: 'test-embedding',
}

const trialPatch = `diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -1,3 +1,4 @@
 {
+  "dependencies": { "zod": "^4.6.7" },
   "name": "demo"
 }
`

const input: IntegrationTrialInput = {
  project: 'acme/app',
  candidate: {
    repo: 'colinhacks/zod',
    summary: 'TypeScript schema validation',
    language: 'TypeScript',
    topics: ['validation'],
    stars: 30_000,
  },
  projectContext: {
    repo: 'acme/app',
    description: 'demo app',
    language: 'TypeScript',
    topics: [],
    dependencies: ['next'],
    readme: null,
    manifestName: 'package.json',
    manifest: '{"name":"demo"}',
  },
  steps: ['安装 zod', '在入口里加一个 schema'],
}

describe('generateIntegrationTrial', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('解析模型返回的补丁，并把项目清单放进提示词', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    summary: '在 package.json 里加上 zod',
                    files: ['package.json'],
                    patch: trialPatch,
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateIntegrationTrial(input, llm)
    expect(result.summary).toContain('zod')
    expect(result.patch).toContain('diff --git a/package.json')
    expect(result.files).toEqual(['package.json'])

    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>
    const body = String(calls[0]?.[1]?.body)
    expect(body).toContain('manifest_file')
    expect(body).toContain('colinhacks/zod')
    expect(body).toContain('安装 zod')
  })

  it('模型连续返回无法解析的内容时抛错', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ choices: [{ message: { content: '这不是 JSON' } }] }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ),
    )

    await expect(generateIntegrationTrial(input, llm)).rejects.toThrow()
  })
})
