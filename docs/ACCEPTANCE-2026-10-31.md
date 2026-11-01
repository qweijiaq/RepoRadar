# RepoRadar 验收记录

日期：2026-10-31

## 环境

- Web：`http://localhost:3000`（Next.js 开发服务器）
- Worker：`pnpm worker`（独立进程，已启动）
- 数据库：`repo-radar-postgres`（PostgreSQL 16 + pgvector，端口 5433）
- 模型：已配置 DeepSeek（`deepseek-flash`）
- 验收账号：本地演示账号；通知邮件使用测试账号

## 自动化检查

| 检查 | 结果 |
| --- | --- |
| `pnpm test` | 通过，47 个测试文件 / 232 项测试 |
| `pnpm typecheck` | 通过 |
| `pnpm --filter @repo-radar/web build` | 通过 |
| 关键页面 GET | `/feed`、`/issue`、`/maintain`、`/copilot`、`/watch`、`/collections`、`/integrations`、`/repos`、`/inbox`、`/history`、`/settings`、`/tasks`、`/trends` 全部 200 |
| 关键接口 | `/api/jobs`、`/api/push/public-key`、`/manifest.webmanifest`、`/sw.js` 全部 200 |
| 未登录访问 | `/api/jobs`、`/api/patches/:id` 返回 401 |

验收过程中发现并修复：`/api/jobs` 未登录时返回空列表（200），已改为 401。

## 通知与设置

- 设置页「邮件通知 / 每周精选」勾选并保存后，跳转 `?notify=saved`，刷新后状态保持，数据库 `users.prefs.notificationPrefs` 同步。
- 「后台自动化」面板显示待投递消息、SMTP 状态、已授权推送设备数。
- 邮件失败重试：邮件投递失败会写入 `last_error`、增加 `attempts`，并按 10/20 分钟退避，3 次后标记失败。
- 站内收件箱、单条已读、分类过滤不受投递失败影响。

## 邮件投递

使用本地测试 SMTP（`smtp://127.0.0.1:2525`）验证三条真实链路：

1. 任务失败提醒：worker 执行失败任务后生成站内通知，并投递「任务失败：验收：失败提醒」邮件。
2. Release 通知：建立 release 基线后，worker 检测到 `cli/cli v2.103.3`，生成通知并投递邮件。
3. 每周精选：worker 为用户生成个性化摘要，投递「RepoRadar 每周精选 — 2026-10-31」邮件，正文包含 8 个项目。

三条邮件均被测试 SMTP 接收，`delivery_queue` 状态为 `sent`。

## 浏览器推送

- 设置页可注册 Service Worker、申请权限、创建真实 FCM 订阅，订阅成功写入 `push_subscriptions`。
- 「发送测试推送」正确调用投递接口。
- 关闭推送后订阅被删除、`pushNotifications` 偏好关闭、UI 同步显示「允许此设备接收推送」。
- 当前网络无法连接 `fcm.googleapis.com`，测试推送返回 500 和 `Socket timeout`，因此未完成在线送达验证。这是环境网络限制，不是代码错误；换到可访问 FCM 的网络后可用同一按钮复测。

## 定时任务

- worker 启动后立即执行一轮活动同步、release 检查和每周摘要检查，之后按 15 / 15 / 30 分钟周期运行。
- Release 检查第一次只建立基线；已有基线后检测到新版本才通知，避免首次订阅补发历史。
- 每周摘要按 ISO 周去重，同一周不会重复发送。
- 用户 GitHub token 用 `AUTH_SECRET` 加密保存，worker 可在页面关闭后同步。

## 修复补丁

使用真实 DeepSeek 模型和本地 Git 仓库夹具验证完整链路：

- 模型读取 Issue、项目上下文和 `src/config.js`，输出 unified diff；
- `git apply --recount` 应用成功；
- Docker 沙箱 `npm run build` 通过；
- 补丁保存为 `patch_drafts` 记录，状态 `validated`；
- 补丁页显示改动说明、验证结果、diff、复制按钮和 `.patch` 下载；
- `/history` 出现「修复补丁」记录；
- 下载接口返回 `text/x-diff` 和附件文件名；
- 未登录访问补丁下载接口返回 401。

## 依赖升级补丁

使用本地 Node 夹具验证：

- 在 `node:22-alpine` 沙箱执行 `npm install is-number@7.0.0`；
- 更新 `package.json` 和 `package-lock.json`；
- 执行 `npm run build` 通过；
- 返回包含 lockfile 的完整 diff，状态 `verified`。

## 清理结果

验收产生的任务、通知、投递队列、推送订阅、补丁、Issue 方案、Release 基线和测试订阅均已删除；测试夹具和临时脚本已移除。当前数据库：

- `delivery_queue`：0
- `push_subscriptions`：0
- `patch_drafts`：0
- `issue_plans`：0
- 用户通知偏好已恢复默认（未开启邮件/推送/周报）

验收截图保留在 `.radar/acceptance/`：

- `settings-notifications.png`
- `settings-push.png`
- `patch-page.png`

## 当前运行状态

- Web 开发服务器：`pnpm dev:web`，`http://localhost:3000`
- Worker：`pnpm worker`，后台运行
- 邮件通道：当前 `.env` 的 `SMTP_URL` 为空；需要实际发邮件时填入 SMTP 地址并重启 worker
- 真实推送：需要可访问 FCM 的网络

## 验收后补充：页面配置与 QQ 邮箱

为满足「所有用户配置都能在页面完成并持久化」，补充了以下能力：

- 设置页「邮件通道」：SMTP 主机、端口、SSL、用户名、密码/授权码、发件人全部可在页面保存，密码用 `AUTH_SECRET` 加密存进 `app_settings`；支持 QQ 邮箱、163、Gmail 和自定义 SMTP 预设。
- 设置页「通知邮箱」：可单独填写收件邮箱（例如 QQ 邮箱），留空时回退到 GitHub 邮箱；worker 投递时按该邮箱发送。
- 设置页「站点地址」：公网 URL 持久化到数据库，用于邮件里的项目链接和 Webhook 完整地址；`RADAR_BASE_URL` 仅作为可选覆盖。
- `SMTP_URL` / `MAIL_FROM` / `RADAR_BASE_URL` 环境变量仍然支持，但只作为管理员覆盖，页面配置在未设置环境变量时生效。
- CLI 的 `pnpm radar digest --send`、worker 定时摘要和 MCP server 都改为读取页面保存的配置。

QQ 邮箱支持情况：

- **作为发件箱**：选择 QQ 邮箱预设（`smtp.qq.com` / 465 / SSL），SMTP 用户名填 QQ 邮箱地址，密码填 QQ 邮箱生成的授权码（不是 QQ 登录密码）。需要先在 QQ 邮箱设置里开启 SMTP 服务。
- **作为收件箱**：在「通知邮箱」直接填写 QQ 邮箱地址即可。
- 已用本地 SMTP 验证页面保存的配置能被 worker 读取并成功投递；QQ 预设的服务器、端口、SSL 和加密保存已验证。真实 QQ SMTP 发送需要用户自己的授权码，未在当前环境中用真实 QQ 账号发送。

## 上线准备第一步：安全与开源基线

- 生产环境缺少 `AUTH_SECRET` 时，加密辅助函数、worker 和 CLI 会 fail-closed；开发环境才允许固定兜底值。
- 新增管理员模型：`ADMIN_LOGINS` 逗号分隔；未设置时最早注册用户作为管理员。AI 模型、邮件通道、站点地址、GitHub OAuth、Webhook Secret 的页面、server action 和读取 Webhook Secret 的 API 都只允许管理员。
- 非管理员设置页只保留个人通知、通知邮箱、推送、订阅、口味和用量等个人配置。
- `/setup` 初始化增加访问控制：localhost 可直接配置；公网必须配置并提交 `SETUP_TOKEN`，否则锁定。
- 生产环境强制关闭 `AUTH_DEV_MODE` 演示登录。
- 升级 zod 到 4.6.7，并用 pnpm override 将 postcss 统一到 8.5.32；`pnpm audit --prod --audit-level=high` 已清零。
- 新增 Apache-2.0 `LICENSE`、`NOTICE`、`SECURITY.md`、`CONTRIBUTING.md`、`CODE_OF_CONDUCT.md`、Issue/PR 模板、Dependabot 和 GitHub Actions CI。
- CI 执行安装、审计、类型检查、测试、迁移和构建。
- 测试数量更新为 41 个文件 / 212 项测试。

## Docker 部署验证

- 新增多阶段 `Dockerfile`：`web`、`worker`、`migrate` 三个运行目标；构建阶段执行 `pnpm build`，运行阶段不依赖 pnpm 在线安装。
- `docker-compose.yml` 扩展为 PostgreSQL + 一次性迁移 + Web + worker；PostgreSQL 只绑定 `127.0.0.1`，worker 挂载 Docker socket。
- 新增 `/api/health`，返回数据库连通状态。
- 在独立 Compose 项目（Web 3001、PostgreSQL 5434）完成全栈启动验证：
  - `/api/health` 返回 200 和 `{"ok":true,"database":"ok"}`；
  - Web 容器健康；
  - worker 容器健康，且容器内可调用宿主 Docker（`docker version` 28.0.1）；
  - `/setup` 返回 200；
  - 迁移服务成功退出，Web/worker 在迁移完成后启动。
- 测试后已执行 `docker compose down -v --rmi local`，删除测试容器、网络、数据库卷和测试镜像。
- 部署说明见 [DEPLOYMENT.md](DEPLOYMENT.md)。

## 限流与配额验证

- 新增每用户 AI 调用/token、全站 token、每小时/每日任务、排队任务、Copilot 消息和邮件/推送投递配额，以及 AI 总开关。
- 管理员设置页可保存和恢复默认配额；非管理员不可见。
- 已实际验证：AI 总开关拒绝、每日 AI 调用上限、任务每小时上限、投递上限和 Copilot 429 响应。
- 新增 `ALLOWED_LOGINS` 内测登录白名单。
- 搜索和测试推送增加单进程频率限制。

## 隐私与数据删除验证

- 设置页新增「隐私与数据」面板，可导出全部个人数据和永久删除账号；
- `/api/account/export` 已验证：返回账户、star、反馈、订阅、项目、报告、任务、Copilot、补丁等数据；任务 payload 中的加密 token 会被移除，推送订阅和 GitHub token 不导出；
- 用临时用户验证级联删除：用户、star、反馈、订阅、收藏、通知、任务、推送订阅、GitHub token 和投递队列全部清零；
- 删除账号要求输入 GitHub 登录名，删除后自动退出登录；
- 每周精选邮件增加签名退订链接，无需登录即可关闭邮件通知；退订流程已实际点击验证；
- `/privacy` 和 `/terms` 页面已添加，页脚已加入链接；
- 测试数据已清理，演示用户通知偏好恢复默认。

## 数据保留与自动清理验证

- 管理员可配置运营记录、Copilot 对话和 AI 生成内容的保留天数；`0` 表示永久保留。
- worker 每 30 分钟检查一次，实际清理最多每 24 小时执行一次，并用 PostgreSQL advisory lock 防止多 worker 重复执行。
- 已用临时数据验证：已读通知、已发送投递、已完成任务、动态事件、LLM 用量、采集记录和验证记录会按阈值删除；未读通知保留；AI 生成内容和 Copilot 对话默认永久保留，配置非零阈值后才会删除。
- 设置页保存保留策略已实际验证，测试配置已清理。

## 可观测性与告警验证

- 新增管理员 `/ops` 面板：任务、投递、token 用量、数据库大小、心跳超时、最近失败记录和告警历史；
- `/api/metrics` 支持 METRICS_TOKEN Bearer 鉴权，输出 Prometheus 文本指标；未配置 token 返回 404，错误 token 返回 401；
- worker 每 5 分钟检查失败任务、失败投递、队列积压和心跳超时，按冷却时间发送告警邮件；
- 用本地 SMTP 实测：构造失败任务、失败投递和积压队列后，worker 成功发送 3 类告警邮件并记录 `ops.alert.*` 状态；
- worker 关键事件使用 JSON 结构化日志；
- `/api/health` 保持数据库健康检查，可用于容器探针；
- 测试告警配置、临时任务/投递和邮件配置已清理。

## 依赖大版本升级

- Next.js 从 15.5.28 升级到 16.4.3；由于 core 使用 NodeNext `.js` 后缀并依赖 webpack extensionAlias，dev/build 显式使用 `--webpack`。
- TypeScript 从 5.9.3 升级到 7.0.2；移除已废弃的 `baseUrl`，改为相对 paths，Next 16 将 JSX 切换为 `react-jsx`。
- 本地 228 项测试、类型检查、生产构建、`pnpm audit` 和 Docker 镜像构建均通过；Docker 全栈健康检查通过。
- Dependabot 配置为忽略 Next / TypeScript / React / next-auth / @types/node 的后续 major，minor/patch 合并成组。

## GitHub OAuth 权限收敛验证

- 默认登录 scope 从 `read:user user:email repo delete_repo` 收敛为 `read:user user:email`；
- 仓库管理、维护周报、Issue 方案和补丁生成需要到 `/repos` 点「授权仓库管理」，通过 OAuth `authorizationParams` 增量申请 `repo`，删除仓库时再单独申请 `delete_repo`；
- JWT 记录实际 scope，`resolveRepoAccess` 会拒绝基础 scope 访问仓库级操作；GitHub 动态同步仍允许基础 scope；
- 用合成 session 验证：基础 scope 在 `/repos` 显示重新授权提示，`/inbox` 仍可访问；完整 scope 通过 scope 检查并进入仓库读取流程；
- `hasRepoScope` 单元测试覆盖基础 scope、public_repo、repo 和空值。

## E2E 测试

- 引入 Playwright，覆盖登录、核心页面、设置/运维面板、仓库授权提示、移动端横向溢出、健康检查和未登录 API 401。
- E2E 使用本地 Chrome 或 CI Chromium，独立 `.next-e2e` 构建目录，可在开发服务器运行时并行执行。
- 本地 `pnpm test:e2e`：12 项通过（含安全响应头）；CI 已加入 Chromium 安装和 E2E 步骤。

## 剩余 Dependabot PR

- 将 Vitest 升级到 5.0.5，229 项单元测试通过。
- 将 GitHub Actions 更新到 actions/checkout@v7、pnpm/action-setup@v6、actions/setup-node@v7；对应 tag 已确认存在。
- Dependabot 配置继续对 Vitest 和以上 Actions 的后续 major 做手动审批。
- 升级后类型检查、构建通过；PR #5 / #8 待推送后由 Dependabot 按新策略关闭或人工关闭。

## 版本化迁移与备份恢复

- schema 已拆到 `packages/core/src/db/migrations/`，`pnpm db:migrate` 按版本执行并记录 checksum 到 `schema_migrations`。
- 已验证：已有数据库基线只应用一次；重复执行跳过；修改已应用迁移文件会拒绝执行；空数据库可以从 `0001_initial` 完整建表。
- Docker 的 `migrate` 服务在空数据库上成功应用基线。
- 新增 `pnpm db:backup` 和 `pnpm db:restore <file>`；备份为 custom-format dump 并生成 SHA-256 校验文件，恢复前要求 `CONFIRM=YES`。
- 已实际备份本地数据库，并恢复到临时数据库验证用户、仓库和迁移记录存在，随后删除临时库和测试备份。

## 安全响应头与 TLS 演练

- `apps/web/proxy.ts` 增加 nonce CSP、`X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy`、`Permissions-Policy`、COOP；HTTPS 请求（含代理传入 `X-Forwarded-Proto: https`）增加 HSTS 和 `upgrade-insecure-requests`。
- 登录页、内联主题脚本和普通页面在 CSP 下正常工作；Issue 的 sandbox `srcdoc` 预览也已验证不受 `frame-src` 影响。
- Caddy 内部 CA 的 HTTPS 演练确认 HSTS、CSP 和安全头存在；本地 HTTP 开发只发送 CSP 和基础头，不发送 HSTS。
- 新增 `deploy/Caddyfile`、`deploy/Caddyfile.local`、`deploy/nginx.conf`；Caddy 本地内部 CA 的 HTTPS 反代已实际启动并通过 `/login` 验证。
- Compose 的 Web 端口默认绑定 `127.0.0.1`，TLS profile 仅在显式启用时启动 Caddy。

## Docker 沙箱加固

- 统一 `sandboxDockerArgs`，所有仓库验证、补丁验证和依赖升级共用。
- 容器以调用方 UID/GID 运行（worker 为 root 时切到 1000:1000），`--cap-drop ALL`、`--security-opt no-new-privileges`、`--read-only`、tmpfs `/tmp` 和 `/run`、`--init`、文件描述符和资源限制。
- npm/pip/go/cargo 缓存重定向到 tmpfs；Python 安装改为 `pip install --user`。
- 用 Node 夹具验证：仓库构建、依赖升级、补丁应用与构建均在加固后的沙箱中通过。
