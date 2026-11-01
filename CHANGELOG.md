# Changelog

本文件记录用户可见的变化。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循语义化版本。

## [Unreleased]

### Added

- ESLint 10 + typescript-eslint 类型感知规则（`no-floating-promises`、`no-misused-promises`、
  `consistent-type-imports`）和 Prettier 配置，`pnpm lint` 接入 CI 且要求零警告。
- 数据库集成测试（`pnpm test:db`）：覆盖迁移、仓库 upsert/改名、pgvector 写入、搜索过滤和
  任务队列抢占，运行在临时 schema 中，跑完自动清理。
- 根路由的 `error.tsx` / `global-error.tsx` / `not-found.tsx` / `loading.tsx`，页面出错或
  404 时不再落到 Next.js 默认页面。
- CI 增加 `lint` 和 `test:db` 步骤、最小化 `permissions`、并发取消、任务超时，并在 E2E 失败时
  上传 Playwright 报告。
- 独立的 `e2e/tsconfig.json`，E2E 测试纳入类型检查。

### Changed

- TypeScript 7 与工具链采用官方推荐的并行别名：`typescript` 指向 `@typescript/typescript6`
  提供 Compiler API，`@typescript/native` 指向 `typescript@7` 提供 `tsc`。
- `tsconfig.json` 纳入 `packages/core/eval` 和 `playwright.config.ts`，此前这两处不受类型检查。
- **feed 首屏不再同步调用模型**：隐藏宝石的中文翻译改为「只读缓存 + 响应结束后后台补写」，
  首次看到英文描述时直接展示原文，翻译结果写入 `repo_translations` 表并跨进程复用。
- **`findEnrichedRepos` 重写**：`stars_7d` 的相关子查询改成 CTE + `DISTINCT ON`，去掉每行一次
  的 N+1；传入用户画像向量时由 pgvector 直接计算相似度（`semanticScore`），feed 不再传输
  500×1536 个浮点数。
- 新增迁移 `0005_repo_translations`（翻译缓存）和 `0006_repos_enriched_quality`
  （`repos (quality_score DESC NULLS LAST) WHERE enriched_at IS NOT NULL` 部分索引）。
- **Web 镜像改用 Next.js `standalone` 输出**：实测 1.53 GB → 236 MB，只保留运行产物；
  worker 镜像改为只装生产依赖并排除 Next 构建产物（896 MB → 845 MB），同时补上 `migrate`
  服务需要的 `apps/worker`；`.dockerignore` 显式排除 `.next`，避免把本地构建产物打进上下文。
- feed 的「语言」「已验证」筛选下推到 SQL，先过滤再取候选窗口，避免小语种被全局前 500
  挤出结果。
- **路由按登录态拆成路由组**：`(app)` 承载全部业务页和个性化导航，`(public)` 承载隐私和条款；
  根布局不再读取会话和请求头，`/privacy`、`/terms` 在构建时预渲染为静态页（`○`）。主题脚本
  改为 `public/theme.js`，不再依赖 per-request nonce。

### Fixed

- 设置页 LLM 测试失败时，用于提取 HTTP 状态码的正则里包含真实的退格字符（`\x08`），导致
  `code` 参数永远为空。
- `job-worker` 中两个未使用的导入，以及若干无效赋值（`verify.ts`、`sync.ts`、`cli.ts`）。
- 迁移失败时保留原始错误作为 `cause`，便于排查。
- 任务队列的状态竞争：`finishJob` 只允许完成 `running` 任务、`failJob` 只允许失败
  `queued`/`running` 任务，迟到结果不会再覆盖已回收/已完成的任务；心跳回收阈值从 10 分钟
  调整为 15 分钟，避免和 10 分钟执行超时互相打架。
- 根布局不再在返回 HTML 前等待未读数查询，`UnreadBadge` 改为 Suspense 流式渲染。
