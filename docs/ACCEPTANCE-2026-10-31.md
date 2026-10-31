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
| `pnpm test` | 通过，41 个测试文件 / 212 项测试 |
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
