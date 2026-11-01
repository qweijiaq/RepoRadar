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


test('recommendation library aggregates history by repository', async ({ page }) => {
  await loginAsDemo(page)
  await page.goto('/library')
  await expect(page.getByRole('heading', { name: '所有历史推荐，按库汇总' })).toBeVisible()
  await expect(page.getByRole('link', { name: /接入建议/ }).first()).toBeVisible()
  await page.goto('/library?tab=watch')
  await expect(page.getByRole('link', { name: /关注命中/ }).first()).toBeVisible()
  await page.goto('/library?tab=maintainer')
  await expect(page.getByRole('link', { name: /维护待办/ }).first()).toBeVisible()
  await page.goto('/library?tab=comparison')
  await expect(page.getByRole('link', { name: /选型对比/ }).first()).toBeVisible()
  await page.goto('/library?tab=discoverability')
  await expect(page.getByRole('link', { name: /曝光优化/ }).first()).toBeVisible()
  await page.goto('/history?kind=integration')
  await expect(page.getByRole('link', { name: '按库汇总' })).toBeVisible()
})


test('task and inbox filters render', async ({ page }) => {
  await loginAsDemo(page)
  await page.goto('/tasks?status=failed')
  await expect(page.getByRole('heading', { name: 'AI 任务中心' })).toBeVisible()
  await expect(page.getByRole('link', { name: '失败' })).toBeVisible()
  await page.goto('/inbox?category=github&unread=1')
  await expect(page.getByRole('heading', { name: '收件箱' })).toBeVisible()
  await expect(page.getByRole('link', { name: /GitHub/ }).first()).toBeVisible()
})
