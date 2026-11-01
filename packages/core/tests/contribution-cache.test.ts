import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearIssueCache, listOpenIssuesCached } from '../src/contribution.js'

describe('listOpenIssuesCached', () => {
  afterEach(() => {
    clearIssueCache()
    vi.unstubAllGlobals()
  })

  it('caches issue lists for 10 minutes', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await listOpenIssuesCached('acme/app')
    await listOpenIssuesCached('acme/app')

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to the cached list when the request fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { number: 1, title: 'first', html_url: 'https://example.com/1', labels: [], comments: 0 },
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockRejectedValueOnce(new Error('network down'))
    vi.stubGlobal('fetch', fetchMock)

    const first = await listOpenIssuesCached('acme/app')
    expect(first).toHaveLength(1)

    // 让缓存过期，再触发一次失败请求。
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60 * 1000)
    const second = await listOpenIssuesCached('acme/app')
    expect(second).toHaveLength(1)
    vi.restoreAllMocks()
  })
})
