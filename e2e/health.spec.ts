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
