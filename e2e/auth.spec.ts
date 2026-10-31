import { expect, test } from '@playwright/test'
import { loginAsDemo } from './helpers'

test('unauthenticated feed redirects to login', async ({ page }) => {
  await page.goto('/feed')
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByRole('heading', { name: '进入你的雷达' })).toBeVisible()
})

test('unauthenticated jobs API returns 401', async ({ request }) => {
  const response = await request.get('/api/jobs')
  expect(response.status()).toBe(401)
})

test('demo login reaches the feed', async ({ page }) => {
  await loginAsDemo(page)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByText('雷达', { exact: true }).first()).toBeVisible()
})
