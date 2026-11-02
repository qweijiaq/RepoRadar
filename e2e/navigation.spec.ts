import { expect, test } from '@playwright/test'
import { loginAsDemo } from './helpers'

test.beforeAll(async ({ browser }) => {
  // 开发服务器首次访问路由时要现编译，先给重型页面一次更长的预热，避免断言超时。
  const page = await browser.newPage()
  await page.goto('/repos', { waitUntil: 'domcontentloaded', timeout: 180_000 }).catch(() => {})
  await page.close()
})

test.beforeEach(async ({ page }) => {
  await loginAsDemo(page)
})

test('core pages render for a signed-in user', async ({ page }) => {
  await page.goto('/tasks')
  await expect(page.getByRole('heading', { name: 'AI 任务中心' })).toBeVisible()

  await page.goto('/inbox')
  await expect(page.getByRole('heading', { name: '收件箱' })).toBeVisible()

  await page.goto('/library?tab=history')
  await expect(page.getByRole('heading', { name: '所有历史推荐，按库汇总' })).toBeVisible()
  await expect(page.getByRole('link', { name: /历史报告/ }).first()).toBeVisible()

  await page.goto('/privacy')
  await expect(page.getByRole('heading', { name: '隐私说明' })).toBeVisible()

  await page.goto('/terms')
  await expect(page.getByRole('heading', { name: '服务条款' })).toBeVisible()
})

test('settings shows per-user and admin controls', async ({ page }) => {
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: '偏好与配置' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '通知' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '隐私与数据' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '限流与配额' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '数据保留与自动清理' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '邮件通道' })).toBeVisible()
})

test('ops dashboard renders admin metrics and alerts', async ({ page }) => {
  await page.goto('/ops')
  await expect(page.getByRole('heading', { name: '运行状态与告警' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '告警配置' })).toBeVisible()
  await expect(page.getByText('reporadar_users_total').first()).toBeVisible()
  await expect(page.getByRole('heading', { name: 'AI 任务质量（近 30 天）' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'AI 成本（近 30 天）' })).toBeVisible()
})

test('repo page explains the elevated permission flow', async ({ page }) => {
  await page.goto('/repos', { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('GitHub 仓库管理')).toBeVisible()
})

test('settings has no horizontal overflow on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/settings')
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})

test('swap lab and contribution radar render', async ({ page }) => {
  await page.goto('/workbench/swap', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: '把一个库换个实现，先在沙箱里试一遍' })).toBeVisible()

  await page.goto('/workbench/contribute', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: '用你熟悉的栈，给相似项目补一块' })).toBeVisible()
})

test('discover and trends pages render', async ({ page }) => {
  await page.goto('/discover', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: '用一句话找到你想要的仓库' })).toBeVisible()

  await page.goto('/trends', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: '本周开源在涨什么' })).toBeVisible()
})
