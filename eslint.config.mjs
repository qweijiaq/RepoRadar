import js from '@eslint/js'
import next from '@next/eslint-plugin-next'
import prettier from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/.next-e2e/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.pnpm-store/**',
      'playwright-report/**',
      'test-results/**',
      '.radar/**',
      'apps/web/public/sw.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mts}'],
    languageOptions: {
      // TypeScript 7 的稳定版 typescript 入口不带 Compiler API，这里由
      // `typescript: npm:@typescript/typescript6` 的别名提供 TS 6 API。
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      // 后台任务和 server action 里漏掉 await 会变成静默失败，这条规则价值最高。
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    ...next.configs.recommended,
    rules: {
      ...next.configs.recommended.rules,
      // 项目只有 App Router，没有 pages 目录。
      '@next/next/no-html-link-for-pages': 'off',
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // React Compiler 专属规则（purity / set-state-in-effect 等）会误判 RSC 和
      // 常见的 hydration 写法，等接入 React Compiler 后再逐条启用。
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['apps/web/**/*.tsx', 'apps/web/app/**/*.ts', 'apps/web/components/**/*.ts'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    // public/ 下是给浏览器直接加载的普通脚本，不是 TS 构建产物。
    files: ['apps/web/public/**/*.js'],
    languageOptions: { globals: globals.browser },
  },
  prettier,
)
