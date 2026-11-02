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
- 覆盖率门槛：`pnpm test:coverage` 统计 `packages/core` 的行/语句/函数/分支覆盖率，CI 用它替代
  `pnpm test`，低于基线（45/44/42/34）会失败。
- **接入预演（Integration Dry-Run）**：接入建议上的「试接入」会在 Docker 沙箱里真的加一次依赖并构建，
  生成带 diff、命令和日志的补丁记录（`patch_drafts.kind = 'integration'`），不会改动远端仓库。
- 分享雷达的 OpenGraph 卡片：`/radar/[token]` 会用快照里的登录名、模式和前三个项目生成 1200×630
  的 PNG；快照不存在或数据库不可用时退回通用卡片。
- 错误上报：`instrumentation.ts` 的 `onRequestError` 和浏览器错误边界统一走 `reportError`，
  写结构化日志；配置 `ERROR_WEBHOOK_URL` 后额外转发 JSON，浏览器错误经 `/api/client-errors`
  （10 次/分钟限流）上报。
- SEO 与分享：`/sitemap.xml`、`/robots.txt`、站点和项目页的 OpenGraph 分享卡（`next/og`），
  以及各页面的 `openGraph` / `twitter` 元数据。

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
  worker 镜像改为只装生产依赖，不再复制 Next 构建产物，同时补上 `migrate`
  服务需要的 `apps/worker`；`.dockerignore` 显式排除 `.next`，避免把本地构建产物打进上下文。
- feed 的「语言」「已验证」筛选下推到 SQL，先过滤再取候选窗口，避免小语种被全局前 500
  挤出结果。
- **路由按登录态拆成路由组**：`(app)` 承载全部业务页和个性化导航，`(public)` 承载隐私和条款；
  根布局不再读取会话和请求头，`/privacy`、`/terms` 在构建时预渲染为静态页（`○`）。主题脚本
  改为 `public/theme.js`，不再依赖 per-request nonce。
- **后台任务执行器从 Web 拆到 `apps/worker`**：`runner` / `handlers` / worker 入口移入
  `apps/worker/src`，Web 通过 `@repo-radar/worker` 复用 `enqueueJob`；任务凭据、Issue 草稿、
  项目上下文、邮件、推送下沉到 `packages/core`，`apps/web/lib` 保留 re-export 兼容层。
  worker 镜像不再包含 Web 源码，并在同一层删掉 Next 相关包（896 MB → 553 MB）。
- 去掉 `apps/web/lib` 下 7 个 re-export 兼容层（db、job-secret、issue-drafts、project-context、
  issue-generation、mailer、push），Web 直接从 `@repo-radar/core` 导入，减少一层间接。

- **feed 主列表改为预计算快照**：新增 `feed_snapshots` 表，worker 每 30 分钟为有画像的用户重算
  排名（最多 300 条），页面按快照顺序取切片；快照缺失/过期时回退实时排名，并在响应结束后补建。
  「加载更多」不再重新排名整个候选池。

- 试接入/换库生成补丁后会做结构检查，失败时带错误重试一次；重试后 `deepseek-chat` 从 5/6 提升到 6/6。
- 真实仓库沙箱验证：`vercel/arg`（API 重建 10 个文件）+ `sindresorhus/meow`，1.6s 生成补丁，
  Docker 中 `npm install` + `npm test` 通过（39 tests）。
- 已把当前部署的默认模型切换为 `deepseek-chat` 并验证：默认配置评测 6/6（36.1s），
  真实 `vercel/arg` 清单的试接入补丁 `git apply` 成功。
- 默认模型决策修订为 `deepseek-chat`（质量打平，速度快约 4.6 倍、输出 token 少约 4.4 倍），
  详见 `docs/MODEL-SELECTION.md`。
- `pnpm eval:ai` 支持多模型对比：按模型汇总通过数/耗时/tokens/成本，并给出推荐（通过数 → 成本 → 耗时）；
  可用 `--prices` 临时覆盖单价。
- `/ops` 新增「AI 成本（近 30 天）」：按模型配置每 1M token 单价，估算输入/输出成本并显示合计。
- e2e 启动前自动清理残留 dev server，并禁止复用旧服务；CI 增加 `next start` 生产冒烟。
- `/ops` 新增「AI 任务质量（近 30 天）」：按任务类型展示成功率、均值/P95 耗时、tokens 和失败原因 Top。
- 新增 `pnpm eval:ai`：用固定场景评测对比/试接入/机械换库的真实输出质量，报告落盘并支持阈值退出。
- docker-compose 新增 `demo` profile（自动 seed）与 `RADAR_DEMO_MODE` 开关；演示账号改为只读，
  写操作统一拦截并显示只读提示。
- 新增 `RADAR_DEMO_MODE=1`：登录页提供「以演示账号进入」，配合 `demo-seed` 可托管只读演示站。
- 换库沙盘的机械模式扩展到 Python / Go / Rust，并支持 requirements.txt、pyproject.toml、
  go.mod、Cargo.toml 的依赖替换；MCP 新增 `generate_swap_trial`。
- 新增 `pnpm radar demo-seed`：写入真实仓库、demo 画像、收藏、订阅和维护项目，方便无 Key 的演示实例。
- 换库沙盘新增「只做机械替换」模式：用 Babel 解析 import/require/re-export，确定性重写模块名，
  不依赖模型；沙箱验证照旧。
- MCP 新增 `generate_integration_preflight` / `generate_comparison` / `get_job_status`，
  agent 可以触发任务并轮询结果（需要 worker 在运行）。
- worker 的代码索引优先用 tree-sitter（wasm）抽取函数/类边界，加载失败时自动退回启发式切块。
- 接入回访的安全公告会先从项目 lockfile 解析真实安装版本，再按精确版本查 OSV；
  解析不到时回退到按包查询。
- 代码索引升级为函数/类级切块（`code_chunks.symbol`，迁移 `0012`）：按导出符号切分，
  检索支持按符号名匹配，接入预演的代码证据会带上 `path#symbol`。
- 接入回访接入 OSV 安全公告（含 `0011_impact_kind`）；代码索引会优先按 `package.json` 的
  `main/module/exports/bin` 选入口文件；贡献雷达的 Issue 列表加 10 分钟缓存并在失败时退回旧数据。
- **AI 功能二批**：接入预演支持目标文件（适配层）、接入后回访（`integration_impacts`）、
  能力差异矩阵、候选仓库代码索引（`code_chunks` + pgvector 检索）、换库沙盘（`/workbench/swap`）、
  贡献雷达（`/workbench/contribute`）和 MCP 决策工具（`pick_library` / `integration_preflight` /
  `similar_diff`）。迁移 0008–0010 已加入。详见 `docs/ROADMAP-AI.md` 与 `docs/HANDOFF.md`。

### Fixed

- 设置页 LLM 测试失败时，用于提取 HTTP 状态码的正则里包含真实的退格字符（`\x08`），导致
  `code` 参数永远为空。
- `job-worker` 中两个未使用的导入，以及若干无效赋值（`verify.ts`、`sync.ts`、`cli.ts`）。
- 迁移失败时保留原始错误作为 `cause`，便于排查。
- 任务队列的状态竞争：`finishJob` 只允许完成 `running` 任务、`failJob` 只允许失败
  `queued`/`running` 任务，迟到结果不会再覆盖已回收/已完成的任务；心跳回收阈值从 10 分钟
  调整为 15 分钟，避免和 10 分钟执行超时互相打架。
- 根布局不再在返回 HTML 前等待未读数查询，`UnreadBadge` 改为 Suspense 流式渲染。
- GitHub 管理接口、README 和 latest release 请求补上 10 秒超时；此前 GitHub 变慢时 `/repos`
  的 SSR 可能一直挂到平台超时。E2E 在导航用例前预热 `/repos`，避免开发模式首次编译导致误报。
