import { afterEach, describe, expect, it, vi } from 'vitest'
import { isLikelyEnglishDescription, translateRepoDescriptions } from '../src/translation.js'

const config = {
  apiKey: 'test-key',
  baseUrl: 'https://example.invalid/v1',
  model: 'test-model',
  embeddingModel: 'test-embedding',
}

describe('hidden gem description translation', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('detects English descriptions and leaves Chinese alone', () => {
    expect(isLikelyEnglishDescription('A small CLI toolkit for building terminal dashboards and reusable widgets.')).toBe(true)
    expect(isLikelyEnglishDescription('一个用于构建终端仪表盘的小型 CLI 工具，支持插件和主题。')).toBe(false)
    expect(isLikelyEnglishDescription('tiny')).toBe(false)
  })

  it('translates English descriptions and caches the result', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  translations: ['一个用于构建终端仪表盘的小型 CLI 工具，支持插件和主题。'],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const text = 'A small CLI toolkit for building terminal dashboards and reusable widgets.'
    const first = await translateRepoDescriptions([text], config)
    expect(first.get(text)).toContain('终端仪表盘')
    const second = await translateRepoDescriptions([text], config)
    expect(second.get(text)).toContain('终端仪表盘')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns an empty map without an LLM config', async () => {
    expect(await translateRepoDescriptions(['A description long enough to be translated here.'], null)).toEqual(
      new Map(),
    )
  })
})
