import { expect, test } from '@playwright/test'
import { loginAsDemo } from './helpers'

test('library search filters and can be cleared', async ({ page }) => {
  await loginAsDemo(page)
  await page.goto('/feed?tab=library')
  const search = page.getByPlaceholder('搜索名称、描述、语言或 topic')
  await expect(search).toBeVisible()
  await search.fill('zzzz-no-such-repo-12345')
  await page.getByRole('button', { name: '搜索', exact: true }).click()
  await expect(page).toHaveURL(/q=zzzz-no-such-repo-12345/)
  await expect(page.getByText('0 个结果')).toBeVisible()
  await page.getByRole('link', { name: '清除搜索' }).click()
  await expect(page).not.toHaveURL(/q=/)
})

test('settings has section navigation and GitHub status', async ({ page }) => {
  await loginAsDemo(page)
  await page.goto('/settings')
  await expect(page.getByRole('navigation', { name: '设置导航' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'GitHub 授权' }).first()).toBeVisible()
  await expect(page.getByRole('heading', { name: 'GitHub 授权' })).toBeVisible()
  await expect(page.getByText('仓库权限：')).toBeVisible()
})

test('offline fallback page is available', async ({ request }) => {
  const response = await request.get('/offline.html')
  expect(response.status()).toBe(200)
  expect(await response.text()).toContain('暂时离线')
})
