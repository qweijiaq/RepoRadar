# 运维、权限与安全

本页覆盖日常运维、GitHub 授权、通知投递、数据保留和限流配额。部署与 TLS 见 [DEPLOYMENT.md](DEPLOYMENT.md)。

## 可观测性与告警

- 管理员打开 `/ops` 查看任务、投递、token 用量、数据库大小、最近失败记录和「验收检查」；
- `pnpm radar doctor` 在命令行跑同一组检查：数据库、pgvector、迁移、候选池、模型/Embedding 覆盖率、GitHub 授权、邮件、站点地址和任务队列；
- 设置 `METRICS_TOKEN` 后，`GET /api/metrics` 输出 Prometheus 文本指标，需要 `Authorization: Bearer <token>`；
- worker 每 5 分钟检查失败任务、失败投递、队列积压和心跳超时任务，按冷却时间发送告警邮件；
- 告警阈值和收件邮箱可在 `/ops` 页面配置，留空时发给 `ADMIN_LOGINS` 对应用户的通知邮箱或 `ALERT_EMAILS`；
- `/api/health` 返回数据库健康状态，可用于容器和负载均衡探针；
- worker 每 6 小时自动刷新候选池（可用 `DISCOVERY_AUTO=off` 关闭），管理员也可以在设置页手动刷新。

## GitHub 权限

默认登录只申请 `read:user user:email`，用于读取公开资料和 star 画像。仓库管理、维护周报、Issue 修复方案和补丁生成需要额外的 `repo` 权限；删除仓库是不可恢复操作，才会单独申请 `delete_repo`：

- 打开 `/repos`，点击「授权仓库管理」重新走一次 GitHub OAuth，只会申请 `repo`；
- 授权后 token 会更新，`/repos`、`/workbench/maintain`、`/issue-plan` 和补丁任务才能读取私有仓库并执行写操作；
- 在仓库管理里执行删除时，如果还没有 `delete_repo`，会单独提示再授权一次；
- 设置页会显示 token 的实际授权范围，而不是只依赖登录时缓存的 scope；
- GitHub 动态同步仍可使用基础登录权限；
- 只需要公开数据的用户不需要授予仓库写权限。

## 通知投递

设置页的「送达方式」可以分别开启邮件通知、浏览器推送和每周精选：

- 站内收件箱始终保留，投递失败不会影响通知本身；
- 邮件在设置页「邮件通道」里配置，内置 QQ 邮箱、163、Gmail 和自定义 SMTP 预设；也可以继续用环境变量 `SMTP_URL` 覆盖。未配置时消息会留在 `delivery_queue`，按 10/20 分钟退避重试，3 次后标记失败；
- 通知邮箱可以在设置页单独填写，支持 QQ、163、Gmail 等任意邮箱；留空时回退到 GitHub 邮箱；
- 浏览器推送使用 Web Push：设置页点「允许此设备接收推送」即可，VAPID 密钥自动生成并加密保存在数据库；PWA service worker 在应用加载时注册；
- 任务失败也会进入同一套投递队列，作为失败提醒；
- 设置页顶部会显示待投递数量、邮件通道状态和已授权推送设备数；
- 设置页「站点地址」用于邮件里的项目链接和 Webhook 完整地址，也可以由 `RADAR_BASE_URL` 环境变量覆盖。

QQ 邮箱作为发件箱时需要开启 SMTP 服务并生成授权码，路径是「QQ 邮箱 → 设置 → 账号 → POP3/IMAP/SMTP 服务」。在「邮件通道」里选择 QQ 邮箱预设（`smtp.qq.com` / 465 / SSL），SMTP 用户名填 QQ 邮箱地址，密码填授权码，不要填 QQ 登录密码。QQ 邮箱作为收件箱时，在「通知邮箱」里直接填写即可。

每周精选邮件底部带签名的退订链接，无需登录即可关闭邮件通知。

## 限流与配额

管理员可以在设置页「限流与配额」里调整：

- 每用户每日 AI 调用次数和 token 上限；
- 全站每日 token 预算；
- 每用户每小时/每日 AI 任务数，以及排队/运行中任务上限（GitHub 动态同步不计入 AI 任务数）；
- Copilot 每小时消息数；
- 每用户每日邮件/推送投递数；
- AI 总开关，用于临时停止所有模型调用（GitHub 动态同步不受影响）。

`0` 表示不限制。限额按 UTC 自然日统计；token 用量在模型调用完成后才入库，所以并发请求可能轻微超出。投递超限时只停止外部邮件/推送，站内通知仍保留。

公测阶段还可以设置 `ALLOWED_LOGINS`，只允许指定 GitHub 登录名登录（管理员自动包含）。搜索和测试推送另有轻量的单进程频率限制；多实例部署需要换成 Redis 或数据库计数。

## 数据保留与自动清理

管理员可以在设置页「数据保留与自动清理」配置已读通知、投递记录、任务、GitHub 动态、LLM 用量、采集记录、验证记录、Copilot 对话和 AI 生成内容的保留天数。`0` 表示永久保留；AI 生成内容默认永久保留，设置非零值会删除历史报告和补丁版本。

worker 每 30 分钟检查一次，实际清理最多每 24 小时执行一次；使用数据库 advisory lock 避免多 worker 重复执行。管理员也可以点「立即清理过期数据」。仅清理已读通知，未读通知不会被自动删除。

## 隐私与数据删除

- 设置页「隐私与数据」可以导出全部个人数据，或永久删除账号及其派生数据；
- 导出不包含 GitHub token、模型/SMTP 密钥和推送订阅密钥；
- 删除账号会退出登录，并通过外键级联清理画像、star、订阅、项目、报告、通知、任务、Copilot 对话、补丁和推送订阅；
- 隐私说明和服务条款分别在 `/privacy` 和 `/terms`。

## 安全边界

- 全局配置（AI 模型、邮件通道、站点地址、GitHub OAuth、Webhook Secret）只允许管理员修改；
- `/setup` 在非 localhost 访问时需要 `SETUP_TOKEN`，避免公网实例被抢先接管；
- 生产环境缺少 `AUTH_SECRET` 会拒绝启动；
- 页面和 API 通过 `apps/web/proxy.ts` 设置 nonce CSP、HSTS（HTTPS）、nosniff、frame 拒绝、Referrer/Permissions Policy；
- Compose 默认只把 Web 绑定到 `127.0.0.1`，公网通过 Caddy/Nginx 终止 TLS；
- patch / 依赖升级 / 仓库验证会在 Docker 中执行不可信代码：沙箱使用非 root UID（worker 为 root 时切到 1000）、`--cap-drop ALL`、只读根文件系统、tmpfs、资源和进程限制；worker 主机仍应按高信任边界隔离，不要和数据库或内部服务共用；
- GitHub 仓库响应和 Webhook payload 会先经过 zod 运行时校验：搜索结果中的异常条目会被跳过，Webhook 结构异常会返回 400；模型返回的 JSON 也由各模块 schema 校验。
- 漏洞报告方式见 [SECURITY.md](../SECURITY.md)。
