import { defineConfig, devices } from '@playwright/test'

try {
  process.loadEnvFile('.env')
} catch {
  // CI 使用进程环境变量
}
try {
  process.loadEnvFile('apps/web/.env.local')
} catch {
  // 可选
}

const port = Number(process.env.E2E_PORT || 3100)
const localChannel = process.env.CI ? undefined : 'chrome'
const inheritedEnv = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => typeof value === 'string'),
) as Record<string, string>

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 6_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 1,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(localChannel ? { channel: localChannel } : {}),
      },
    },
  ],
  webServer: {
    command: `pnpm --filter @repo-radar/web exec next dev --webpack -p ${port}`,
    url: `http://127.0.0.1:${port}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...inheritedEnv,
      AUTH_DEV_MODE: '1',
      ADMIN_LOGINS: 'demo',
      AUTH_SECRET: process.env.E2E_AUTH_SECRET || process.env.AUTH_SECRET || 'e2e-only-not-a-production-secret',
      DATABASE_URL: process.env.DATABASE_URL || 'postgres://radar:radar@localhost:5433/radar',
      NEXT_DIST_DIR: '.next-e2e',
      METRICS_TOKEN: '',
      RADAR_INLINE_JOBS: '0',
    },
  },
})
