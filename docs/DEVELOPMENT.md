# 开发与命令

本页面向本地开发和二次开发，包含 CLI 命令、模型配置、环境变量、项目结构和测试方式。生产部署见 [DEPLOYMENT.md](DEPLOYMENT.md)。

## 快速开始（本地）

```bash
# 1. 启动 Postgres（含 pgvector）
docker compose up -d postgres

# 2. 安装依赖
pnpm install

# 3. 配置环境变量
cp .env.example .env
cp apps/web/.env.local.example apps/web/.env.local
# 至少设置 AUTH_SECRET；本地想跳过 GitHub OAuth 可把 AUTH_DEV_MODE 改为 1

# 4. 建库
pnpm db:migrate

# 5. 采集 → 富化 → 查看推荐
pnpm radar ingest --topics=llm,ai-agents --days=30
pnpm radar enrich --limit=50
pnpm radar list --limit=20

# 6. 启动 Web
pnpm dev:web        # http://localhost:3000
```

也可以一条命令跑完整流水线：

```bash
pnpm radar pipeline --topics=llm --limit=20
```

首次使用打开 `/setup` 配置 GitHub OAuth（含可一键复制的回调地址），然后填写 Client ID / Client Secret。凭据保存在数据库 `app_settings` 表，Secret 使用 AES-256-GCM 加密。想用环境变量管理凭据也可以：设置 `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` 后重启，环境变量优先。

登录时会自动读取最近 200 个公开 star，生成画像并落到 `users` / `user_stars` 表。

## 命令

| 命令 | 说明 |
| --- | --- |
| `pnpm db:migrate` | 应用未执行的数据库迁移 |
| `pnpm db:backup` | 备份 PostgreSQL 到 `backups/`，并生成 SHA-256 |
| `pnpm db:restore <file>` | 恢复备份（需要 `CONFIRM=YES`） |
| `pnpm radar ingest` | 从 GitHub Search 采集候选仓库，记录每日 star 快照 |
| `pnpm radar enrich` | 对未富化仓库：抓 README → LLM 摘要/评分/向量（无 LLM 时退化为启发式规则） |
| `pnpm radar list` | 按 质量 + 新鲜度 + 增速 排序输出推荐列表 |
| `pnpm radar digest` | 生成个性化摘要（Markdown / HTML，可发邮件） |
| `pnpm radar issue` | 生成周报选题证据包（真实 release + 主题聚类候选） |
| `pnpm radar verify` | 在 Docker 沙箱中克隆、安装并构建候选仓库，记录结果与日志 |
| `pnpm radar rising` | 按近 7 天 star 相对增速输出「正在起飞」项目 |
| `pnpm radar releases` | 检查 release 订阅仓库的最新版本并入库 |
| `pnpm radar activity --user=<login>` | 轮询维护仓库的 star / fork / Issue / PR / release 动态 |
| `pnpm radar mcp` | 以 MCP server（stdio）运行，供 agent 调用 |
| `pnpm radar pipeline` | ingest → enrich → list |
| `pnpm radar doctor` | 检查数据库、迁移、候选池、模型/Embedding、GitHub 授权、邮件、站点地址和任务队列 |
| `pnpm radar backfill-identities` | 为已有仓库回填 GitHub 稳定 ID，支持 `--limit` 和 `--delay-ms` |
| `pnpm radar demo-seed` | 写入演示数据：10 个真实仓库 + 画像/收藏/订阅/维护项目，可重复执行 |
| `pnpm eval:llm` | 用 6 个固定 README 样本回归评测富化提示词，通过率低于 80% 时失败 |

常用参数：`--topics`、`--days`、`--pages`、`--delay-ms`、`--language`、`--limit`、`--format=md|json`、`--dry-run`。`backfill-identities` 需要 `GITHUB_TOKEN` 或已登录用户 token。运行 `pnpm radar help` 查看完整说明。

## 模型配置

打开 `/settings` → **AI 模型**，选择服务商和模型，填入 API Key 即可。保存后 CLI（`pnpm radar issue --draft`、`pnpm radar enrich`）会自动读取，不需要改环境变量或文件。

- 支持 8 家服务商、45 个预置模型：Anthropic、OpenAI、DeepSeek、阿里云百炼（Qwen）、Google Gemini、xAI（Grok）、智谱 GLM、Moonshot（Kimi）；模型字段也支持手动填写新模型。
- 设置页可以单独配置 Embedding 模型（默认 `text-embedding-3-small`），留空则关闭语义向量，相似度和排序退化为文本/关键词匹配。
- Anthropic 走原生 Messages API，其余使用 OpenAI 兼容接口。
- API Key 用 AES-256-GCM 加密后存入 `app_settings`，不会写入文件；设置页只显示末四位。
- 管理员仍可以用 `LLM_API_KEY` 等环境变量覆盖页面配置（环境变量优先）。

> CLI 读取页面配置时需要 `AUTH_SECRET` 来解密，它会自动从仓库根目录 `.env` 或 `apps/web/.env.local` 中读取。

## 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `AUTH_SECRET` | 是 | Auth.js 会话和数据库加密密钥；生产环境缺失会拒绝启动，生成：`openssl rand -base64 32` |
| `ADMIN_LOGINS` | 公网建议 | 管理员 GitHub 登录名，逗号分隔；未设置时最早注册的用户为管理员 |
| `ALLOWED_LOGINS` | 公测建议 | 注册/登录白名单，逗号分隔；设置后只有名单内用户能登录，管理员自动包含 |
| `METRICS_TOKEN` | 否 | `/api/metrics` 的 Bearer 令牌；未设置时接口返回 404 |
| `ALERT_EMAILS` | 否 | 运维告警收件邮箱，逗号分隔；也可在 `/ops` 页面配置 |
| `SETUP_TOKEN` | 公网首次配置建议 | `/setup` 初始化令牌；非 localhost 访问且未设置时配置页锁定 |
| `RADAR_DEMO_MODE` | 否 | 设为 `1` 时登录页出现「以演示账号进入」，使用 `demo-radar` 的预置数据 |
| `RADAR_BASE_URL` | 否 | 站点公开地址；未设置时使用设置页保存的值 |
| `GITHUB_WEBHOOK_SECRET` | 否 | 可选的 Webhook Secret；也可以直接在设置页保存，环境变量优先 |
| `GITHUB_TOKEN` | 建议 | 公开仓库只读 token 即可（https://github.com/settings/tokens）。需要页面仓库管理时授予 `repo`；删除仓库时再单独授予 `delete_repo`。不填则匿名访问，Search 限 10 次/分钟且跳过 README |
| `DATABASE_URL` | 否 | 默认 `postgres://radar:radar@localhost:5433/radar` |
| `LLM_API_KEY` | 否 | 管理员覆盖项；优先于页面配置。不填时使用页面里保存的模型配置 |
| `LLM_PROVIDER` | 否 | 环境变量覆盖时的服务商 id（默认 `openai`） |
| `LLM_BASE_URL` | 否 | 默认 `https://api.openai.com/v1` |
| `LLM_MODEL` | 否 | 默认 `gpt-4o-mini` |
| `LLM_PROTOCOL` | 否 | `openai`（默认）或 `anthropic` |
| `EMBEDDING_MODEL` | 否 | 默认 `text-embedding-3-small`（pgvector 维度 1536） |
| `SMTP_URL` | 否 | 覆盖设置页保存的 SMTP 连接串 |
| `MAIL_FROM` | 否 | 发件人，默认 `RepoRadar <radar@localhost>` |
| `RADAR_TOPICS` | 否 | 默认 `ai-agents,llm,developer-tools,mcp,cli` |
| `RADAR_DAYS` | 否 | 默认 30 |
| `RADAR_DELAY_MS` | 否 | 默认 2200（GitHub Search API 限 30 次/分钟） |

## 评测与版本

固定样本评测：

```bash
pnpm eval:llm
```

默认读取环境变量里的模型配置；没有环境变量时回退到本机设置页保存的模型。评测会检查 6 个固定 README 样本的 verdict 和质量分区间，通过率低于 80% 时退出 1。CI 不调用真实模型，只运行提示词/解析契约测试。

评分和提示词版本在 `packages/core/src/versions.ts`：

- `SCORING_VERSION`：当前评分公式版本；
- `PROMPT_VERSIONS`：各任务提示词版本；
- 报告 payload、`quality_detail` 和 `llm_usage` 会记录版本，便于对比换模型前后的结果。

## 项目结构

```text
packages/core/    可复用核心库：配置、数据库、GitHub 客户端、LLM、富化、评分、个性化、邮件/推送
apps/worker/      后台任务执行器 + CLI（tsx 运行）：任务队列、定时同步、ingest / enrich / MCP
apps/web/         Web 应用（Next.js + Auth.js）：登录、口味画像、feed、公开项目页
docs/             功能、部署、运维、路线图和样刊
```

后台任务的执行代码（`runner` / `handlers` / worker 入口）在 `apps/worker/src`，Web 通过 `@repo-radar/worker` 复用 `enqueueJob`，因此 worker 镜像不需要携带 Next.js。共享的业务模块（任务凭据、Issue 草稿、项目上下文、邮件、推送）放在 `packages/core`，`apps/web/lib` 下只保留同名 re-export，避免两边各写一份。

数据库 schema 位于 `packages/core/src/db/migrations/`，按文件名顺序执行；已应用版本和 checksum 记录在 `schema_migrations` 表，由 `pnpm db:migrate` 应用。新增变更时请添加新的迁移文件，不要修改已应用的历史文件。

## 测试与检查

```bash
pnpm lint        # ESLint（含 typescript-eslint 类型感知规则、react-hooks）
pnpm format      # Prettier 格式化（首次运行会重排较多历史文件）
pnpm typecheck   # 全仓类型检查（core / worker / e2e / web）
pnpm test        # 单元测试（vitest，全部使用 mock，不需要数据库）
pnpm test:coverage  # 单元测试 + 覆盖率门槛（packages/core）
pnpm test:db     # 数据库集成测试（真实 Postgres，需要 TEST_DATABASE_URL）
pnpm test:e2e    # Playwright E2E；本地使用已安装的 Chrome，CI 使用 Chromium
pnpm build       # 生产构建
```

数据库集成测试覆盖迁移、`upsertRepo`、向量写入、搜索过滤和任务队列抢占。它会在 `TEST_DATABASE_URL` 指向的库里创建一个临时 schema（`radar_integration`），跑完自动删除，不会碰开发数据：

```bash
TEST_DATABASE_URL=postgres://radar:radar@localhost:5433/radar pnpm test:db
```

> TypeScript 7 的稳定 `typescript` 入口不带 Compiler API，`package.json` 用官方推荐的别名的并行配置：`typescript` 指向 `@typescript/typescript6` 给 ESLint 用，`@typescript/native` 指向 `typescript@7` 提供 `tsc`。不要把它们改回同一个包，否则 ESLint 会在启动时直接报错。

## 渲染与缓存

路由按「是否需要登录态」分成两个路由组：

- `app/(app)/`：雷达、工作台、设置等全部业务页。`(app)/layout.tsx` 读取会话并渲染带用户信息的导航，因此这些页面是按请求动态渲染（`ƒ`）。
- `app/(public)/`：隐私、条款。`(public)/layout.tsx` 不读会话，只渲染品牌、「登录」和主题切换，构建时预渲染成静态页（`○`）。

关键是 **根布局 `app/layout.tsx` 不能读会话，也不能调用 `headers()`**，否则整个站点都会变成动态。主题脚本因此从内联改成 `public/theme.js`，用 `next/script` 的 `beforeInteractive` 加载——同源脚本靠 CSP 的 `'self'` 就能跑，不需要 per-request nonce（`proxy.ts` 仍然给 Next 自己的脚本下发 nonce）。

取舍：公开页的导航是「未登录版本」，登录用户访问 `/privacy` 会看到「登录」而不是完整的雷达导航。要让公开页也带个性化导航，就需要 Cache Components（静态壳 + 动态洞），那是一次全站迁移，目前没做。

`(app)` 里的未读数查询拆到了 `<Suspense>` 包裹的 `UnreadBadge`，不会阻塞页面首字节。

## 沙箱验证

对高分候选在 Docker 里真实 clone、安装和构建，结果写回仓库并在 Web 上展示「已验证」标记：

```bash
pnpm radar verify --limit=3                 # 验证质量分 ≥ 0.6 的前 3 个仓库
pnpm radar verify --repo=owner/name         # 只验证指定仓库
pnpm radar verify --limit=5 --dry-run       # 只看会验证哪些
```

- 自动识别 node / python / go / rust；node 项目优先跑 `build`，没有则跑 `test`。
- 容器限制：2GB 内存、2 CPU、512 进程、无额外权限；单仓库默认超时 10 分钟。
- 日志写入 `.radar/verifications/`（已 gitignore），最近一次日志摘要会展示在项目详情页。
- **安全提醒**：验证过程会执行仓库里的构建脚本，属于不可信代码。容器做了资源与权限隔离，但仍在宿主机 Docker 上运行，且为安装依赖保留了网络访问。只对自己信任的来源使用，或在专门的无密钥机器上运行。

## 内容样刊

`docs/issues/` 下保存了用于验证「情报卡片 + 周报」形态的样刊：

- [第 001 期](issues/001-2026-10-30.md)：LLM / Agent 画像
- [第 002 期](issues/002-2026-10-30.md)：TypeScript CLI 画像

生成新一期所需的证据包：

```bash
pnpm radar issue --user=<login> --limit=12 --release-limit=15 --out=evidence.md
```

它会拉取你 star / 订阅仓库的最新 release，按画像主题聚类候选，输出带真实证据（版本、日期、star、推送时间）的 Markdown 草稿，叙述部分由人或 LLM 在此基础上完成。

配置好模型后，可以让模型直接生成完整周报草稿：

```bash
pnpm radar issue --user=<login> --draft                          # Markdown 草稿
pnpm radar issue --user=<login> --draft --format=html --out=issue.html   # 可直接发送的 HTML
```
