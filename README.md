# RepoRadar

> A personalized radar for open-source projects — verified, explained, and relevant to you.

一个懂你口味的开源项目雷达：从 GitHub 和社区信号中自动发现值得关注的开源项目，按你的技术栈和兴趣排序，给你「已验证、讲得清、可行动」的精选。

> **状态：可自托管运行** —— 采集 → 富化 → 个性化推荐 → 反馈 / 多样性 / 摘要邮件 / 沙箱验证 / MCP server / 订阅 / 加速度雷达 / 接入建议 / 仓库管理 / 维护周报 / 曝光优化 / 订阅代理 / 后台 worker / 通知投递 / 修复补丁 / 依赖升级。产品与架构设计见 [docs/PRD.md](docs/PRD.md)。

## 快速开始

```bash
# 1. 启动 Postgres（含 pgvector）
docker compose up -d postgres

# 2. 安装依赖
pnpm install

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env：强烈建议填入 GITHUB_TOKEN（不填也能运行，但限流更严）；LLM_API_KEY 可选

# 4. 建库
pnpm db:migrate

# 5. 采集 → 富化 → 查看推荐
pnpm radar ingest --topics=llm,ai-agents --days=30
pnpm radar enrich --limit=50
pnpm radar list --limit=20
```

也可以一条命令跑完整流水线：

```bash
pnpm radar pipeline --topics=llm --limit=20
```

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

常用参数：`--topics`、`--days`、`--pages`、`--delay-ms`、`--language`、`--limit`、`--format=md|json`、`--dry-run`。运行 `pnpm radar help` 查看完整说明。

## 可观测性与告警

- 管理员打开 `/ops` 查看任务、投递、token 用量、数据库大小和最近失败记录；
- 设置 `METRICS_TOKEN` 后，`GET /api/metrics` 输出 Prometheus 文本指标，需要 `Authorization: Bearer <token>`；
- worker 每 5 分钟检查失败任务、失败投递、队列积压和心跳超时任务，按冷却时间发送告警邮件；
- 告警阈值和收件邮箱可在 `/ops` 页面配置，留空时发给 `ADMIN_LOGINS` 对应用户的通知邮箱或 `ALERT_EMAILS`；
- `/api/health` 返回数据库健康状态，可用于容器和负载均衡探针。

## GitHub 权限

默认登录只申请 `read:user user:email`，用于读取公开资料和 star 画像。仓库管理、维护周报、Issue 修复方案和补丁生成需要额外的 `repo` + `delete_repo` 权限：

- 打开 `/repos`，点击「授权仓库管理」重新走一次 GitHub OAuth；
- 授权后 token 会更新，`/repos`、`/maintain`、`/issue-plan` 和补丁任务才能读取私有仓库并执行写操作；
- GitHub 动态同步仍可使用基础登录权限；
- 只需要公开数据的用户不需要授予仓库写权限。

## Docker 部署

完整栈（PostgreSQL + 迁移 + Web + worker）：

```bash
cp .env.example .env
# 编辑 .env：AUTH_SECRET、ADMIN_LOGINS、SETUP_TOKEN、RADAR_BASE_URL
docker compose up -d --build
curl -fsS http://localhost:3000/api/health
```

首次打开 `/setup` 配置 GitHub OAuth。worker 需要挂载 Docker socket 来运行补丁/依赖升级沙箱，部署安全边界见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。

## Web（M1）

Web 应用在 `apps/web`（Next.js + Auth.js）：

```bash
cd apps/web
cp .env.local.example .env.local
# 必填 AUTH_SECRET（openssl rand -base64 32）
# 管理员：ADMIN_LOGINS=你的GitHub登录名（未设置时最早注册用户为管理员）
# 公网首次配置：SETUP_TOKEN=随机字符串，或只用 localhost 完成初始化
# 可选：AUTH_DEV_MODE=1 使用「本地演示登录」
cd ../..
pnpm dev:web        # http://localhost:3000
```

首次使用：打开 http://localhost:3000/setup，页面会引导你创建 GitHub OAuth App（含可一键复制的回调地址），然后直接填写 Client ID / Client Secret。凭据保存在数据库 `app_settings` 表，Secret 使用 AES-256-GCM 加密。

想用环境变量管理凭据也可以：设置 `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` 后重启，环境变量优先于页面配置。

页面：

| 路径 | 说明 |
| --- | --- |
| `/` | 落地页 |
| `/setup` | 首次配置引导：创建 OAuth App、填写凭据 |
| `/login` | GitHub 登录 / 本地演示登录 |
| `/feed` | 精选雷达：机会卡 + 隐藏宝石；「工具库」标签保留全量列表 |
| `/settings` | 模型配置、口味画像、排除规则、订阅、重新同步 star、管理 OAuth |
| `/integrations` | 基于你维护中的项目，推荐可接入或可替换的开源项目 |
| `/maintain` | 维护工作台：健康度、依赖升级、Issue/PR 待办与修复方案 |
| `/copilot` | AI 项目搭档：基于项目、周报、接入和关注目标对话 |
| `/watch` | 用自然语言描述想找的项目，AI 持续匹配候选 |
| `/inbox` | 收件箱：发布、接入、任务和 GitHub 动态，支持单条已读 |
| `/history` | 所有 AI 生成内容的历史记录与模型溯源 |
| `/tasks` | 后台 AI 任务中心，可并行运行、查看进度和结果 |
| `/compare` | 对一份接入报告里的候选做选型对比 |
| `/issue-plan` | 单个 Issue 的修复方案与任务书 |
| `/repos` | 管理自己的 GitHub 仓库：批量新建、修改、删除 |
| `/repos/[owner]/[name]/optimize` | 单个仓库的曝光优化：描述、Topics、README 首屏 |
| `/r/[owner]/[name]` | 单仓库公开页（可分享、带 SEO 元数据） |
| `/radar/[token]` | 公开分享的雷达快照，无需登录 |

登录时会自动读取最近 200 个公开 star，生成画像并落到 `users` / `user_stars` 表。

### 雷达页

`/feed` 默认不再按标签铺仓库列表，而是先给「今天值得做的几件事」：

- **机会卡**：从维护周报的 Issue/依赖风险、接入建议和关注代理命中里挑最多 3 条，带「为什么给你看」的证据和下一步入口；
- **隐藏宝石**：现场搜索小而活跃的项目（50–5000 stars、近 3 年创建、近 120 天有推送），排除大厂官方仓库、awesome 清单、教程和模板；支持「换一批」；
- **不感兴趣**：选择原因（太宽泛 / 又是官方库 / 不是我的栈 / 早知道 / 其他），雷达会记住并收紧后续筛选；
- **工具库**：原来的标签分组、筛选、简报和 release 更新都保留在这个标签下，适合已经知道自己要找什么的时候。

雷达顶部还可以切换「综合 / 补项目 / 换工具 / 找灵感 / 看新东西」五种模式，并会根据维护项目生成一个轻量的「雷达人格」。模式会保存到用户偏好，下次进入仍然生效。展示过的隐藏宝石会进入 7 天冷却，刷新和「换一批」会优先给没看过的项目。顶部「分享雷达」会生成一个无需登录的只读快照。

### AI 搭档

`/copilot` 是一个懂当前上下文的项目搭档：

- 读取你的维护项目、最新维护周报、接入建议、关注代理和历史生成记录；
- 可以问「这周先做什么」「我的项目最该补什么」「帮我从接入建议里挑一个」；
- 回答会引用具体项目、依赖、Issue 和候选，不会声称已经执行代码或开 PR；
- 对话持久化，支持多会话、新建和删除；
- 快捷动作可以直接生成维护周报或接入建议。

对话请求走页面内的 API，不会把导航锁住；需要长任务的报告生成仍然走 `/tasks` 后台队列。

隐藏宝石现场搜索需要 GitHub token；没有 token 或搜索失败时会回退到已收录的候选池。当前候选池的来源和数量仍会影响结果，后续可以增加定时采集来扩大覆盖。

### 历史与溯源

所有 AI 生成内容都会保留，重新生成不会覆盖旧版本：

- `/history` 汇总接入建议、维护周报、技术周报、曝光优化、选型对比和 Issue 修复方案，显示生成时间、模型和原始内容入口；
- 每类报告都可以通过 `?report=` / `?draft=` / `?plan=` 回看具体历史版本；
- 接入报告会记录本次候选池，对比报告会记录本次候选，方便确认结论基于什么；
- 收件箱里的新通知会直接链接到对应的报告版本；
- `/history` 支持导出 JSON（当前导出的是索引元数据，不含完整报告正文）。

雷达、接入建议、维护待办、关注代理和隐藏宝石都支持「已接入 / 已完成」状态；标记后不会再出现在后续推荐里。依赖完成状态绑定到具体的目标版本，新的大版本出现时会重新出现。

### 后台 AI 任务

接入、维护周报、技术周报、曝光优化、选型对比、修复方案和关注匹配都不再阻塞页面：

- 点击生成后会创建一个持久化任务并立即跳到 `/tasks`；
- 任务在后台并行执行，期间可以正常浏览其他页面；
- 导航栏「任务」显示运行中的数量，任务中心显示进度、错误和结果入口；
- 任务完成后结果仍进入对应的历史记录，也可以通过收件箱打开；
- 支持取消、失败/取消后手动重试、失败自动重试一次、10 分钟超时和心跳恢复；
- 同一用户最多同时运行 2 个任务，其余排队；
- 设置页显示近 30 天的模型调用次数和 token 用量。

任务和执行结果都存在数据库里；中途失败会保留错误信息。默认 Web 进程也会立即执行任务，适合本地开发；生产环境建议设置 `RADAR_INLINE_JOBS=0`，只让独立 worker 执行：

```bash
pnpm worker
```

worker 会处理 `ai_jobs` 队列、恢复心跳超时的任务，并执行定时工作：每 15 分钟同步 GitHub 动态和关注的 release，每周为开启「每周精选」的用户生成摘要，持续投递邮件和浏览器推送。登录时 OAuth token 会用 `AUTH_SECRET` 加密保存，worker 因此能在用户不打开页面时继续同步其仓库动态。

### 隐私与数据删除

- 设置页「隐私与数据」可以导出全部个人数据，或永久删除账号及其派生数据；
- 导出不包含 GitHub token、模型/SMTP 密钥和推送订阅密钥；
- 删除账号会退出登录，并通过外键级联清理画像、star、订阅、项目、报告、通知、任务、Copilot 对话、补丁和推送订阅；
- 每周精选邮件底部带签名的退订链接，无需登录即可关闭邮件通知；
- 隐私说明和服务条款分别在 `/privacy` 和 `/terms`。

### 数据保留与自动清理

管理员可以在设置页「数据保留与自动清理」配置已读通知、投递记录、任务、GitHub 动态、LLM 用量、采集记录、验证记录、Copilot 对话和 AI 生成内容的保留天数。`0` 表示永久保留；AI 生成内容默认永久保留，设置非零值会删除历史报告和补丁版本。

worker 每 30 分钟检查一次，实际清理最多每 24 小时执行一次；使用数据库 advisory lock 避免多 worker 重复执行。管理员也可以点「立即清理过期数据」。仅清理已读通知，未读通知不会被自动删除。

### 限流与配额

管理员可以在设置页「限流与配额」里调整：

- 每用户每日 AI 调用次数和 token 上限；
- 全站每日 token 预算；
- 每用户每小时/每日 AI 任务数，以及排队/运行中任务上限（GitHub 动态同步不计入 AI 任务数）；
- Copilot 每小时消息数；
- 每用户每日邮件/推送投递数；
- AI 总开关，用于临时停止所有模型调用（GitHub 动态同步不受影响）。

`0` 表示不限制。限额按 UTC 自然日统计；token 用量在模型调用完成后才入库，所以并发请求可能轻微超出。投递超限时只停止外部邮件/推送，站内通知仍保留。

公测阶段还可以设置 `ALLOWED_LOGINS`，只允许指定 GitHub 登录名登录（管理员自动包含）。搜索和测试推送另有轻量的单进程频率限制；多实例部署需要换成 Redis 或数据库计数。

### 通知投递

设置页的「送达方式」可以分别开启邮件通知、浏览器推送和每周精选：

- 站内收件箱始终保留，投递失败不会影响通知本身；
- 邮件在设置页「邮件通道」里配置，内置 QQ 邮箱、163、Gmail 和自定义 SMTP 预设；也可以继续用环境变量 `SMTP_URL` 覆盖。未配置时消息会留在 `delivery_queue`，按 10/20 分钟退避重试，3 次后标记失败；
- 通知邮箱可以在设置页单独填写，支持 QQ、163、Gmail 等任意邮箱；留空时回退到 GitHub 邮箱；
- 浏览器推送使用 Web Push：设置页点「允许此设备接收推送」即可，VAPID 密钥自动生成并加密保存在数据库；PWA service worker 在应用加载时注册；
- 任务失败也会进入同一套投递队列，作为失败提醒；
- 设置页顶部会显示待投递数量、邮件通道状态和已授权推送设备数；
- 设置页「站点地址」用于邮件里的项目链接和 Webhook 完整地址，也可以由 `RADAR_BASE_URL` 环境变量覆盖。

QQ 邮箱作为发件箱时需要开启 SMTP 服务并生成授权码，路径是「QQ 邮箱 → 设置 → 账号 → POP3/IMAP/SMTP 服务」。在「邮件通道」里选择 QQ 邮箱预设（`smtp.qq.com` / 465 / SSL），SMTP 用户名填 QQ 邮箱地址，密码填授权码，不要填 QQ 登录密码。QQ 邮箱作为收件箱时，在「通知邮箱」里直接填写即可。

### 修复补丁与依赖升级

Issue 修复方案页可以点「生成修复补丁」：

- 读取 Issue、项目上下文和最多 8 个相关文件，让模型输出 `git apply` 可用的 unified diff；
- 在临时克隆里检查补丁能否应用，再把构建/测试放进 Docker 沙箱执行（资源、进程数、权限受限）；
- 结果保存为可回看的补丁版本，显示改动文件、构建状态和完整日志，可复制或下载 `.patch`；
- 不自动提交、推送、创建 PR 或关闭 Issue，需要人工审阅后执行。

维护周报里的依赖项可以点「生成升级补丁」：worker 在 Docker 沙箱里执行对应包管理器的升级命令（npm / pnpm / yarn / Go / Cargo，Python requirements 直接改版本），再跑构建或测试，最后返回包含 lockfile 的完整 diff。构建失败时仍保留补丁和日志，方便判断升级风险。

### 收件箱与 GitHub 动态

`/inbox` 支持按「全部 / GitHub / AI 工作 / 版本 / 系统」分类、只看未读、单条「标记已读」和「全部标记已读」。进入收件箱时，如果距离上次同步超过 6 小时，会自动排一个后台任务检查维护中仓库的 GitHub 动态：

- 新 star、fork、打开的 Issue / PR、发布的 release；
- 第一次同步只建立基线，不补发历史动态；
- 之后的动态来自仓库 events API 最近 30 条，忽略自己触发的操作；
- 应用打开时每 5 分钟会触发一次轻量心跳，实际同步间隔约 15 分钟；
- 也可以随时点「同步 GitHub 动态」手动触发；
- 在设置页可以分别关闭 star / fork / Issue / PR / release 通知；
- 在设置页生成/保存 Webhook Secret（加密存数据库），保存后可点「复制已保存的 Secret」再次复制；也可以在环境变量配置 `GITHUB_WEBHOOK_SECRET`。然后在仓库添加完整公网地址 `https://你的域名/api/github/webhook`（不能只填路径），即可实时接收。环境变量优先。

没有配置 Webhook 时，GitHub 动态是轮询，通知会有延迟；同步任务在 `/tasks` 中可以看到进度。

如果希望应用关闭后也持续轮询，直接运行 `pnpm worker` 即可；它会用数据库中加密保存的用户 token 定时同步。也可以手动跑：

```bash
pnpm radar activity --user=你的登录名
```

第一次运行只建立基线，不补发历史动态。Webhook 和轮询可以同时存在，事件会用 delivery/event ID 去重。

### 接入建议

打开 `/integrations`，标记正在维护的项目后生成报告。每份报告支持「复制全部给 AI」，单个项目也可以「复制给 AI」：

- 复制出的 Markdown 任务书包含项目摘要、能力缺口、候选仓库、选择理由、参考步骤和给代码 AI 的执行约束；
- 可以直接粘贴给 Claude Code、Cursor 等代码 AI，让它在目标项目里核实候选并执行接入；
- 任务书会要求 AI 先读项目、核实许可证与 API、只改目标项目、补测试并运行现有检查，避免照着建议盲改。

每条建议可以标记「已接入 / 不感兴趣」。下一次生成时，已拒绝的候选会被后端强制过滤，已采纳的方向会作为偏好参考。

### 维护周报

`/maintain` 把维护中项目的三件事合成一张周报：

- **健康度**：测试、CI、Issue/PR 积压、维护活跃度，以及 3-5 条本周建议动作；
- **依赖升级**：读取依赖清单和 lockfile（package-lock / pnpm / yarn / poetry / go / cargo），按实际安装版本查询 npm / PyPI 最新版本和 OSV 安全公告，标出风险，并尝试读取候选仓库的最新 release notes；
- **Issue / PR 待办**：按「现在 / 本周 / 稍后」分组，给出处理建议和回复草稿。

生成结果可以复制成维护任务书；Issue 待办还可以继续生成「修复方案」，包含可能涉及的文件、实现步骤、测试、风险和验收标准。

依赖升级现在覆盖 npm / PyPI / Go / crates.io；OSV 查询对这四个生态生效。修复方案只做规划，不会自动改代码、提交或开 PR。

### 曝光优化

打开 `/repos`，在任意仓库上点「曝光优化」，或者访问 `/repos/[owner]/[name]/optimize`：

- 从定位清晰度、搜索关键词、README 首屏、差异化和信任信号五个维度评分；
- 给出新的仓库描述、Topics、README 首屏建议和按影响排序的执行动作；
- 确认后可以直接把描述和 Topics 写回 GitHub；README 不会自动修改；
- 私有仓库会提示「不会被 GitHub 搜索发现」，建议先评估是否公开。

### 订阅代理

`/watch` 支持用一句话描述长期关注的项目，例如「MIT、TypeScript、能做 agent 长期记忆、最近三个月有 release」。AI 会在已收录的高质量候选池里判断匹配度、给出理由并写入通知，不需要拆成 topic / 语言规则。

### 选型对比

接入报告里的项目卡片支持「对比候选」。系统会读取目标项目和候选的 README / 依赖，输出适配度、优势、弱点、迁移成本、推荐项和验证步骤，并可复制成对比任务书。迁移成本是初步估算，替换前应先用小范围 spike 验证。

### 仓库管理

`/repos` 支持选择一个或多个仓库后批量操作：

- **批量新建**：一次输入最多 10 个仓库名，共用描述、可见性、`.gitignore` 与许可证模板；
- **批量修改**：统一改描述、可见性（公开/私有）或归档状态；也可以单仓改名；
- **批量删除**：需要勾选确认，删除后不可恢复。

GitHub 登录会请求 `repo` 与 `delete_repo` 授权。旧会话如果只授过 `read:user`，页面会提示重新授权。自托管场景也可以用 `GITHUB_TOKEN` 环境变量兜底（需要同样范围的权限）。

删除仓库是高风险操作，建议只在自己有权限的仓库上使用；RepoRadar 不会自动删除任何仓库。

## 模型配置（页面）

打开 `/settings` → **AI 模型**，选择服务商和模型，填入 API Key 即可。保存后 CLI（`pnpm radar issue --draft`、`pnpm radar enrich`）会自动读取，不需要改任何环境变量或文件。

Key 使用 AES-256-GCM 加密后存在数据库里。设置页会显示「Key 已保存（末四位）」；同步画像、重新登录都不会清除它。只有更换服务商或主动点击「清除模型配置」时才需要重新输入。如果 `AUTH_SECRET` 发生变化导致旧 Key 无法解密，页面会明确提示，重新填写一次即可。

- 支持 8 家服务商、45 个预置模型：Anthropic、OpenAI、DeepSeek、阿里云百炼（Qwen）、Google Gemini、xAI（Grok）、智谱 GLM、Moonshot（Kimi）；模型字段也支持手动填写新模型。
- Anthropic 走原生 Messages API，其余使用 OpenAI 兼容接口。
- API Key 用 AES-256-GCM 加密后存入 `app_settings`，不会写入文件。
- 管理员仍可以用 `LLM_API_KEY` 等环境变量覆盖页面配置（环境变量优先），方便 CI 或托管部署。

> CLI 读取页面配置时需要 `AUTH_SECRET` 来解密，它会自动从仓库根目录 `.env` 或 `apps/web/.env.local` 中读取。



- **反馈闭环**：feed 卡片上的「收藏 / 不感兴趣」会写入 `feedback` 表。收藏会提升相关 topic 的权重并让仓库略微靠前；不感兴趣会立即隐藏该仓库，并把它的 topic 权重调低。
- **订阅规则**：在设置页或通过 MCP 添加 topic / language / author / release 订阅。前三类会提升相关项目的排序（单条订阅最多 +0.1，总计上限 +0.2）；release 订阅用于追踪版本更新。
- **版本更新**：`pnpm radar releases` 会检查所有 release 订阅仓库的最新版本并写入 `release_events`，feed 顶部展示「关注项目的更新」。建议和 digest 一起放进定时任务。
- **多样性约束**：排序后按 topic 和语言做软配额（默认每个 topic 最多 2 个、单语言不超过 60%），候选不足时自动放宽。
- **加速度雷达**：`pnpm radar rising --limit=10` 按近 7 天 star 相对增速排序，feed 顶部也会展示前 3 个「正在起飞」项目。需要至少 7 天的 star 快照历史。
- **摘要**：

```bash
pnpm radar digest --user=demo --limit=10          # 打印 Markdown
pnpm radar digest --user=demo --format=html --out=/tmp/digest.html
pnpm radar digest --all --send                    # 通过 SMTP 发给所有有画像的用户
```

`--send` 会优先使用设置页保存的邮件通道；也可以用 `SMTP_URL`（例如 `smtp://user:pass@smtp.example.com:587`）和 `MAIL_FROM` 覆盖。收件人默认取页面通知邮箱或用户邮箱，也可以 `--to=` 指定。配合系统 cron 或 GitHub Actions 即可实现每周推送。

## 内容形态与样刊

`docs/issues/` 下保存了用于验证「情报卡片 + 周报」形态的样刊：

- [第 001 期](docs/issues/001-2026-10-30.md)：LLM / Agent 画像
- [第 002 期](docs/issues/002-2026-10-30.md)：TypeScript CLI 画像

生成新一期所需的证据包：

```bash
pnpm radar issue --user=<login> --limit=12 --release-limit=15 --out=evidence.md
```

它会拉取你 star / 订阅仓库的最新 release，按画像主题聚类候选，输出带真实证据（版本、日期、star、推送时间）的 Markdown 草稿，叙述部分由人或 LLM 在此基础上完成。

### 自动叙事（需要 LLM）

配置好模型后，可以让模型直接生成完整周报草稿：

```bash
pnpm radar issue --user=<login> --draft                          # Markdown 草稿
pnpm radar issue --user=<login> --draft --format=html --out=issue.html   # 可直接发送的 HTML
```

- 模型只输出结构化 JSON（主题、条目、行动），Markdown/HTML 渲染和校验在本地完成；
- 主题和忽略项里引用的仓库必须出现在证据中，否则会被自动丢弃，防止编造项目；
- 个别条目格式不合格时会被跳过而不是让整份草稿失败；
- 版本号和日期仍然依赖模型忠实引用证据，发布前建议人工复核。

## 验证（M3）

对高分候选在 Docker 里真实 clone、安装和构建，结果写回仓库并在 Web 上展示「已验证」标记：

```bash
pnpm radar verify --limit=3                 # 验证质量分 ≥ 0.6 的前 3 个仓库
pnpm radar verify --repo=owner/name         # 只验证指定仓库
pnpm radar verify --limit=5 --dry-run       # 只看会验证哪些
```

- 自动识别 node / python / go / rust；node 项目会优先跑 `build` 脚本，没有则跑 `test`。
- 容器限制：2GB 内存、2 CPU、512 进程、无额外权限；单仓库默认超时 10 分钟。
- 日志写入 `.radar/verifications/`（已 gitignore），最近一次日志摘要会展示在项目详情页。
- **安全提醒**：验证过程会执行仓库里的构建脚本，属于不可信代码。容器做了资源与权限隔离，但仍在宿主机 Docker 上运行，且为安装依赖保留了网络访问。只对自己信任的来源使用，或在专门的无密钥机器上运行。

## MCP server（M4）

RepoRadar 可以作为 MCP server 接入 Claude Code、Cursor、X-Code 等 agent。启动方式：

```bash
pnpm radar mcp        # stdio 传输
```

在 MCP 客户端里配置（路径换成你的项目路径）：

```json
{
  "mcpServers": {
    "repo-radar": {
      "command": "node",
      "args": ["--import", "tsx", "/absolute/path/to/repo-radar/apps/worker/src/mcp-server.ts"],
      "env": { "RADAR_MCP_USER": "你的 GitHub 登录名" }
    }
  }
}
```

提供的工具：

| 工具 | 作用 |
| --- | --- |
| `search_repos` | 按关键词 / topic / 语言搜索已富化项目 |
| `get_recommendations` | 基于画像、反馈和订阅返回个性化推荐 |
| `get_digest` | 生成 Markdown 摘要 |
| `get_repo` | 仓库摘要与最近一次验证结果 |
| `record_feedback` | 写入收藏 / 不感兴趣 |
| `add_subscription` | 添加 topic / language / author / release 订阅 |
| `list_rising` | 近 7 天增速最快的项目 |
| `list_release_updates` | 关注仓库的最新 release |

`RADAR_MCP_USER` 用于给没有显式传 `login` 的工具提供默认用户。

## 环境变量补充

| 变量 | 说明 |
| --- | --- |
| `SMTP_URL` | 可选，覆盖设置页保存的 SMTP 连接串 |
| `MAIL_FROM` | 发件人，默认 `RepoRadar <radar@localhost>` |
| `RADAR_BASE_URL` | 可选，覆盖设置页的站点地址；默认 `http://localhost:3000` |

## 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `AUTH_SECRET` | 是 | Auth.js 会话和数据库加密密钥；生产环境缺失会拒绝启动，生成：`openssl rand -base64 32` |
| `ADMIN_LOGINS` | 公网建议 | 管理员 GitHub 登录名，逗号分隔；未设置时最早注册的用户为管理员 |
| `ALLOWED_LOGINS` | 公测建议 | 注册/登录白名单，逗号分隔；设置后只有名单内用户能登录，管理员自动包含 |
| `METRICS_TOKEN` | 否 | `/api/metrics` 的 Bearer 令牌；未设置时接口返回 404 |
| `ALERT_EMAILS` | 否 | 运维告警收件邮箱，逗号分隔；也可在 `/ops` 页面配置 |
| `SETUP_TOKEN` | 公网首次配置建议 | `/setup` 初始化令牌；非 localhost 访问且未设置时配置页锁定 |
| `RADAR_BASE_URL` | 否 | 站点公开地址；未设置时使用设置页保存的值 |
| `GITHUB_WEBHOOK_SECRET` | 否 | 可选的 Webhook Secret；也可以直接在设置页保存，环境变量优先 |
| `GITHUB_TOKEN` | 建议 | 公开仓库只读 token 即可（https://github.com/settings/tokens）。需要页面仓库管理时授予 `repo` + `delete_repo`。不填则匿名访问，Search 限 10 次/分钟且跳过 README |
| `DATABASE_URL` | 否 | 默认 `postgres://radar:radar@localhost:5433/radar` |
| `LLM_API_KEY` | 否 | 管理员覆盖项；优先于页面配置。不填时使用页面里保存的模型配置 |
| `LLM_PROVIDER` | 否 | 环境变量覆盖时的服务商 id（默认 `openai`） |
| `LLM_BASE_URL` | 否 | 默认 `https://api.openai.com/v1` |
| `LLM_MODEL` | 否 | 默认 `gpt-4o-mini` |
| `LLM_PROTOCOL` | 否 | `openai`（默认）或 `anthropic` |
| `EMBEDDING_MODEL` | 否 | 默认 `text-embedding-3-small`（pgvector 维度 1536） |
| `RADAR_TOPICS` | 否 | 默认 `ai-agents,llm,developer-tools,mcp,cli` |
| `RADAR_DAYS` | 否 | 默认 30 |
| `RADAR_DELAY_MS` | 否 | 默认 2200（GitHub Search API 限 30 次/分钟） |

## 部署安全

- 全局配置（AI 模型、邮件通道、站点地址、GitHub OAuth、Webhook Secret）只允许管理员修改；
- `/setup` 在非 localhost 访问时需要 `SETUP_TOKEN`，避免公网实例被抢先接管；
- 生产环境缺少 `AUTH_SECRET` 会拒绝启动；
- patch / 依赖升级 / 仓库验证会在 Docker 中执行不可信代码，worker 主机应按高信任边界隔离，不要和数据库或内部服务共用；
- 漏洞报告方式见 [SECURITY.md](SECURITY.md)。

## 项目结构

```
packages/core/    可复用核心库：配置、数据库、GitHub 客户端、LLM、富化、评分、个性化
apps/worker/      CLI（tsx 运行）：ingest / enrich / list / pipeline
apps/web/         Web 应用（Next.js + Auth.js）：登录、口味画像、feed、公开项目页
docs/PRD.md       产品与技术设计文档
```

数据库 schema 位于 `packages/core/src/db/migrations/`，按文件名顺序执行；已应用版本和 checksum 记录在 `schema_migrations` 表，由 `pnpm db:migrate` 应用。新增变更时请添加新的迁移文件，不要修改已应用的历史文件。

## 开发

```bash
pnpm typecheck   # 全仓类型检查
pnpm test        # 单元测试（vitest）
pnpm test:e2e    # Playwright E2E；本地使用已安装的 Chrome，CI 使用 Chromium
```

## 路线图

- [x] M0：monorepo 骨架、数据库、采集 + 富化 + 列表
- [x] M1：Web（GitHub OAuth、口味画像、feed、公开项目页）
- [x] M2：反馈闭环、多样性约束、摘要生成与邮件发送
- [x] M3：Docker 沙箱验证（clone / install / build + 日志证据）
- [x] M4：MCP server、订阅规则（topic / language / author / release）、加速度雷达
- [ ] 下一阶段（M5–M8）：核心假设验证、发布工程、依赖健康、规模化 —— 见 [docs/ROADMAP.md](docs/ROADMAP.md)

## 许可证

Apache-2.0。见 [LICENSE](LICENSE)。
