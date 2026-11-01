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
  await expect(page).toHaveURL(/\/library\?tab=history/)
  await expect(page.getByRole('heading', { name: '所有历史推荐，按库汇总' })).toBeVisible()
  await expect(page.getByRole('link', { name: /历史报告/ }).first()).toBeVisible()
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


test('navigation is consolidated and legacy routes redirect', async ({ page }) => {
  await loginAsDemo(page)
  const nav = page.locator('.site-nav')
  await expect(nav.getByRole('link', { name: '雷达', exact: true })).toBeVisible()
  await expect(nav.getByRole('link', { name: '工作台', exact: true })).toBeVisible()
  await expect(nav.getByRole('link', { name: '建议库', exact: true })).toBeVisible()
  await expect(nav.getByRole('link', { name: '仓库', exact: true })).toBeVisible()
  await expect(nav.getByRole('link', { name: '设置', exact: true })).toBeVisible()
  await expect(nav.getByRole('link', { name: '周报', exact: true })).toHaveCount(0)

  await page.goto('/maintain')
  await expect(page).toHaveURL(/\/workbench\/maintain/)
  await expect(page.locator('.workbench-tabs')).toBeVisible()
  await expect(page.locator('.workbench-tab.active')).toContainText('维护')

  await page.goto('/collections')
  await expect(page).toHaveURL(/\/feed\?tab=collections/)
  await expect(page.getByRole('link', { name: '收藏' }).first()).toHaveClass(/active/)
})


test('similar comparison and project-centric integration views render', async ({ page }) => {
  await loginAsDemo(page)
  await page.goto('/workbench/maintain')
  await expect(page.getByRole('link', { name: '相似项目对比' }).first()).toBeVisible()
  await page.goto('/workbench/maintain/similar')
  await expect(page.getByRole('heading', { name: '选择一个维护中的项目' })).toBeVisible()

  await page.goto('/workbench/maintain/similar?repo=qweijiaq/x-code')
  await expect(page.getByRole('heading', { name: 'qweijiaq/x-code' })).toBeVisible()
  await expect(page.getByRole('button', { name: '开始对比' })).toBeVisible()

  await page.goto('/library?tab=integration&view=project')
  await expect(page.getByRole('link', { name: '按库查看' })).toBeVisible()
  await expect(page.getByText('还没有可用的历史接入建议。')).toBeVisible()
})

test('load more keeps the scroll position', async ({ page }) => {
  await loginAsDemo(page)
  await page.goto('/feed?tab=library')
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  const before = await page.evaluate(() => window.scrollY)
  await page.getByRole('link', { name: '加载更多' }).click()
  await page.waitForTimeout(800)
  const after = await page.evaluate(() => window.scrollY)
  expect(before).toBeGreaterThan(100)
  expect(after).toBeGreaterThan(100)
})
