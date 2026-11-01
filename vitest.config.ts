import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/**/tests/**/*.test.ts'],
    // 集成测试需要真实 Postgres，单独用 pnpm test:db 运行。
    exclude: ['**/node_modules/**', '**/tests/integration/**'],
    environment: 'node',
  },
})
