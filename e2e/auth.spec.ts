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

test('public legal page renders without a session', async ({ page }) => {
  await page.goto('/privacy')
  await expect(page.getByRole('heading', { name: '隐私说明' })).toBeVisible()
  await expect(page.getByRole('link', { name: '登录' })).toBeVisible()
})

test('theme script runs before the app and sets the theme', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('radar-theme', 'dark'))
  await page.goto('/privacy')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test('demo mode signs in with the seeded demo account', async ({ page }) => {
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '以演示账号进入' }).click()
  await expect(page).toHaveURL(/\/feed/)
  await expect(page.getByRole('link', { name: '工作台' }).first()).toBeVisible()
  await expect(page.getByText('演示账号只读')).toBeVisible()
})
