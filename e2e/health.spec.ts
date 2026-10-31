import { expect, test } from '@playwright/test'

test('health endpoint reports database connectivity', async ({ request }) => {
  const response = await request.get('/api/health')
  expect(response.status()).toBe(200)
  expect(await response.json()).toEqual({ ok: true, database: 'ok' })
})

test('metrics is disabled without METRICS_TOKEN', async ({ request }) => {
  const response = await request.get('/api/metrics')
  expect(response.status()).toBe(404)
})

test('account export requires authentication', async ({ request }) => {
  const response = await request.get('/api/account/export')
  expect(response.status()).toBe(401)
})

test('security headers are present', async ({ request }) => {
  const response = await request.get('/login')
  expect(response.status()).toBe(200)
  const headers = response.headers()
  expect(headers['content-security-policy']).toContain("default-src 'self'")
  expect(headers['content-security-policy']).toContain('nonce-')
  expect(headers['x-content-type-options']).toBe('nosniff')
  expect(headers['x-frame-options']).toBe('DENY')
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
  expect(headers['permissions-policy']).toContain('camera=()')
})
