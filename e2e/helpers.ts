import { expect, type Page } from '@playwright/test'

export async function loginAsDemo(page: Page): Promise<void> {
  await page.goto('/login')
  await page.getByRole('button', { name: '本地演示登录' }).click()
  await expect(page).toHaveURL(/\/feed/)
}
