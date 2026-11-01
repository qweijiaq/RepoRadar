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

test('sitemap and robots are served', async ({ request }) => {
  const sitemap = await request.get('/sitemap.xml')
  expect(sitemap.status()).toBe(200)
  expect(await sitemap.text()).toContain('/privacy')

  const robots = await request.get('/robots.txt')
  expect(robots.status()).toBe(200)
  expect(await robots.text()).toContain('Sitemap:')
})

test('site opengraph image renders as PNG', async ({ request }) => {
  const site = await request.get('/opengraph-image')
  expect(site.status()).toBe(200)
  expect(site.headers()['content-type']).toContain('image/png')
})

test('client error endpoint validates payloads', async ({ request }) => {
  const invalid = await request.post('/api/client-errors', { data: {} })
  expect(invalid.status()).toBe(400)

  const ok = await request.post('/api/client-errors', {
    data: { message: 'e2e client error', path: '/feed' },
  })
  expect(ok.status()).toBe(200)
})
