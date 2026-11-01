import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/**/tests/integration/**/*.test.ts'],
    environment: 'node',
    // 所有用例共享一个 schema，串行执行避免互相 truncate。
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
