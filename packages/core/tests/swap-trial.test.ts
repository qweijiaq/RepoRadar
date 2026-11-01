import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateSwapTrial } from '../src/swap.js'

const llm = {
  apiKey: 'test-key',
  baseUrl: 'https://example.invalid/v1',
  model: 'test-model',
  embeddingModel: 'test-embedding',
}

const patch = `diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -1,3 +1,3 @@
 {
-  "dependencies": { "axios": "^1.0.0" },
+  "dependencies": { "ofetch": "^1.4.0" },
   "name": "demo"
 }
`

const input = {
  project: 'acme/app',
  projectContext: {
    repo: 'acme/app',
    description: 'demo',
    language: 'TypeScript',
    topics: [],
    dependencies: ['axios'],
    readme: null,
    manifestName: 'package.json',
    manifest: '{"name":"demo"}',
  },
  fromPackage: 'axios',
  toPackage: 'ofetch',
  targetFile: { path: 'src/http.ts', content: "import axios from 'axios'" },
}

describe('generateSwapTrial', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('把旧包名、新包名和目标文件放进提示词并解析补丁', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    summary: '把 axios 换成 ofetch',
                    files: ['package.json'],
                    patch,
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateSwapTrial(input, llm)
    expect(result.patch).toContain('ofetch')
    expect(result.summary).toContain('axios')

    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>
    const body = String(calls[0]?.[1]?.body)
    expect(body).toContain('axios')
    expect(body).toContain('ofetch')
    expect(body).toContain('src/http.ts')
  })
})
