import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reportError } from '../src/error-report.js'

describe('reportError', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('没有配置 webhook 时只写结构化日志', async () => {
    vi.stubEnv('ERROR_WEBHOOK_URL', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await reportError({ source: 'client', message: 'boom', path: '/feed' })

    expect(fetchMock).not.toHaveBeenCalled()
    const logged = vi.mocked(console.error).mock.calls.at(-1)?.[0] as string
    expect(JSON.parse(logged)).toMatchObject({
      level: 'error',
      event: 'error.client',
      message: 'boom',
      path: '/feed',
    })
  })

  it('配置了 webhook 时把错误转发出去', async () => {
    vi.stubEnv('ERROR_WEBHOOK_URL', 'https://hooks.example.invalid/errors')
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await reportError({ source: 'request', message: 'x'.repeat(2000), userId: 7 })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://hooks.example.invalid/errors')
    const body = JSON.parse(String(init.body)) as { message: string; userId: number; app: string }
    expect(body.app).toBe('repo-radar')
    expect(body.userId).toBe(7)
    expect(body.message.length).toBeLessThanOrEqual(1001)
  })

  it('webhook 失败不会抛错', async () => {
    vi.stubEnv('ERROR_WEBHOOK_URL', 'https://hooks.example.invalid/errors')
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('network down'))))

    await expect(reportError({ source: 'server', message: 'x' })).resolves.toBeUndefined()
    expect(console.warn).toHaveBeenCalled()
  })
})
