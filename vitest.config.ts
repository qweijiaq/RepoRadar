import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/**/tests/**/*.test.ts'],
    // 集成测试需要真实 Postgres，单独用 pnpm test:db 运行。
    exclude: ['**/node_modules/**', '**/tests/integration/**'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['packages/core/src/**/*.ts'],
      exclude: [
        'packages/core/src/index.ts',
        'packages/core/src/types.ts',
        'packages/core/src/db/migrations/**',
      ],
      // 基线（2026-11-02）：lines 49.1 / statements 48.1 / functions 44.9 / branches 36.9。
      // 门槛定在基线下方一点，先防止回退，后续提升覆盖率时同步上调。
      thresholds: {
        lines: 45,
        statements: 44,
        functions: 42,
        branches: 34,
      },
    },
  },
})
