# RepoRadar 功能盘点、问题审计与扩展建议

> 审计日期：2026-11-05  
> 代码基线：`036f3dc`（`fix: poster numbering, short date and footer`）  
> 审计范围：`apps/web`、`apps/worker`、`packages/core`、数据库迁移、文档与部署配置  
> 说明：本文只做盘点与建议，不包含代码改动。文中的“触发时机”指用户可见行为或后台任务实际发生的时间点；“身份”指当前代码真实生效的权限，而不是产品愿望。

---

## 0. 结论摘要

RepoRadar 目前已经不是一个“推荐列表”原型，而是一个围绕开源项目发现、选型、接入、维护和内容分发的完整工作台。当前代码中可识别出：

- **40 个页面路由**（其中 8 个是旧地址重定向/兼容页）；
- **18 个 API 路由**；
- **16 类后台 AI / 异步任务**；
- **20 个 MCP 工具**；
- **17 个 CLI 命令**；
- **12 类 worker 定时循环**；
- 约 **60 个用户可感知的功能点**，覆盖账号、雷达、发现、趋势、榜单、分享、维护、接入、对比、补丁、换库、贡献、关注、Copilot、仓库管理、通知、建议库、运维和数据治理。

**整体判断：**

1. **功能密度很高，但导航和入口已经开始过载。** 顶部 8 个一级入口，工作台 7 个 tab，建议库 6 个 tab，设置页 15 个分区；新用户很难在 30 秒内建立心智模型。
2. **权限模型只有“登录用户 / 管理员 / 演示账号”三层，缺少团队、组织、只读成员、审计员等中间角色。** 这是未来做团队技术雷达和托管服务时最大的结构缺口。
3. **演示账号的“只读”承诺没有在所有写路径上落实。** 部分 server action 和 API 有拦截，但 feed、Copilot、关注代理等路径仍然可以写库；更严重的是，在未配置 `ADMIN_LOGINS` 的空库演示环境中，`demo-radar` 可能成为最早注册用户，从而被判定为管理员。
4. **存在明显的“旧同步 AI 流程”和“新任务队列流程”并存。** `apps/web/app/actions.ts` 以及 `compare/actions.ts`、`issue-plan/actions.ts`、`maintain/actions.ts` 中有一批未被页面引用的旧 server action，属于死代码和重复实现。
5. **后台任务里有几个低成本就能修的性能/一致性问题。** 例如每日快照循环每 2 秒查两次数据库、Webhook 与轮询使用不同去重键导致重复通知、发布订阅通知绕过用户的 Release 偏好。
6. **产品最有价值的差异化仍然是“证据 + 沙箱验证 + 可执行下一步”。** 新增功能应围绕这条主线，而不是继续横向堆叠 AI 报告类型。

---

## 1. 身份与权限模型

当前没有独立的角色表，身份由登录方式、GitHub OAuth scope、环境变量和数据库中的用户顺序共同决定。

| 身份 | 判定方式 | 当前能做什么 | 主要限制 |
| --- | --- | --- | --- |
| 匿名访客 | 未登录 | 首页、登录页、`/setup`（受主机和 `SETUP_TOKEN` 限制）、隐私/条款、公开收藏集、公开雷达快照、退订链接、健康检查 | 不能进入业务页；公开收藏集和分享快照是少数无需登录的内容 |
| 登录用户 | GitHub OAuth 登录，基础 scope `read:user user:email` | 雷达、发现、趋势、榜单、分享、工作台、建议库、仓库列表、通知、设置、任务中心、Copilot | 不能读写私有仓库，不能执行仓库管理、补丁、维护周报等需要 `repo` 的操作 |
| 已授权 `repo` 的用户 | 在 `/repos` 重新授权，token 含 `repo` | 仓库创建/编辑/归档、维护周报、Issue 方案、补丁、依赖升级、换库、接入预演、曝光优化写回 | 不能删除仓库；部分操作还要求 token 属于当前登录用户本人 |
| 已授权 `delete_repo` 的用户 | 在上面基础上再授权 `delete_repo` | 批量删除自己的 GitHub 仓库 | 删除不可恢复；页面要求勾选确认；不会自动删除 |
| 管理员 | `ADMIN_LOGINS` 中的登录名；未配置时，数据库中最早注册的用户 | 全局 AI 模型、邮件通道、站点地址、GitHub OAuth、Webhook Secret、限流配额、数据保留、候选池刷新、`/ops`、告警配置、模型单价 | 管理员是叠加身份，不是独立账号；管理员也不能绕过 GitHub scope 去操作别人的仓库 |
| 演示账号 | `RADAR_DEMO_MODE=1` 时通过 Credentials 登录为 `demo-radar` | 设计上只读浏览预置数据 | 当前只读拦截不完整；且可能因“最早用户”规则获得管理员身份 |
| 本地开发账号 | `AUTH_DEV_MODE=1` 且非生产环境 | 本地演示登录为 `demo`、载入演示口味 | 仅开发环境可用 |
| Worker / CLI | 直接运行 `pnpm worker` 或 `pnpm radar ...` | 采集、富化、排序、摘要、验证、快照、发布检查、动态同步、邮件投递、MCP stdio | 不是 Web 身份，拥有数据库和模型配置的完整访问权 |
| MCP 客户端 | stdio 启动 MCP server，使用 `RADAR_MCP_USER` 作为默认用户 | 搜索、推荐、摘要、建议库、待办、反馈、订阅、趋势、意图搜索、生成任务、任务状态 | 默认用户由环境变量决定；没有 OAuth 授权，依赖本机信任边界 |
| GitHub Webhook | GitHub 带 `X-Hub-Signature-256` 调用 | 实时写入 star/fork/Issue/PR/release 动态 | 只处理 `user_projects` 中标记为活跃的仓库；actor 为本人时跳过通知 |
| Prometheus 抓取器 | `Authorization: Bearer <METRICS_TOKEN>` | 读取 `/api/metrics` | 未配置 token 时接口返回 404 |

### 1.1 管理员判定逻辑

- `ADMIN_LOGINS` 非空：只认名单内的登录名，大小写不敏感。
- `ADMIN_LOGINS` 为空：`SELECT id FROM users ORDER BY id LIMIT 1`，即最早注册的用户是管理员。设计意图是保证自托管首次部署可用，但会带来两个风险：
  - 公网实例如果先被别人登录，别人会成为管理员；
  - 空库演示环境中，`demo-radar` 可能成为最早用户并拥有管理员权限。
- `requireAdmin()` 只检查管理员身份，不检查演示账号；因此演示账号一旦成为管理员，仍可进入 `/ops` 和执行全局配置写操作。

### 1.2 身份相关的产品缺口

- 没有“团队成员”“只读成员”“审计员”“组织所有者”等角色。
- 没有邀请、成员管理、权限分配、操作审计日志。
- 没有“个人 API Token”或“机器用户”，MCP/CLI 只能靠本机环境变量。
- 没有“按用户配置模型 Key”的能力，当前模型配置是全站全局的。

---

## 2. 功能全景

下面按用户旅程分组。每张表的“触发时机”说明功能在什么时候发生；“身份”说明当前代码实际允许谁使用。

### 2.1 入口、账号与公共页面

| 功能 | 入口 | 触发时机 | 可用身份 | 说明 |
| --- | --- | --- | --- | --- |
| 首页 | `/` | 访问根路径 | 匿名 | 产品介绍、卖点、登录入口；已登录会跳转 `/feed` |
| GitHub 登录 | `/login`、`/api/auth/*` | 点击“使用 GitHub 登录” | 匿名 | 登录成功后创建/更新用户、保存加密 token、同步 star 画像（最多 200 个 star） |
| 本地开发登录 | `/login` | 点击“本地演示登录” | 匿名，仅 `AUTH_DEV_MODE=1` 且非生产 | 创建/复用 `demo` 用户 |
| 演示账号登录 | `/login` | 点击“以演示账号进入” | 匿名，仅 `RADAR_DEMO_MODE=1` | 创建/复用 `demo-radar`，设计上只读 |
| 首次 OAuth 配置 | `/setup` | 首次部署、未配置 GitHub 凭据时 | 匿名；本机访问或提供 `SETUP_TOKEN` | 保存 Client ID/Secret；已在设置页配置过时仅管理员可改 |
| 隐私说明 / 服务条款 | `/privacy`、`/terms` | 点击页脚或设置页链接 | 匿名 | 静态公开页 |
| 邮件退订 | `/unsubscribe?token=...` | 点击每周精选邮件底部链接 | 匿名，凭签名 token | 关闭 `emailNotifications` 和 `weeklyDigest` |
| PWA / 离线页 | `/sw.js`、`manifest`、`offline.html` | 页面加载、安装 PWA、离线访问 | 任意 | 注册 service worker；离线时展示离线页 |
| 主题切换 / 命令面板 | 顶部导航 | 点击或快捷键 | 已登录/匿名视页面而定 | 主题切换、命令面板快捷跳转 |
| 导出个人数据 | `GET /api/account/export` | 设置页点击“导出全部数据” | 登录用户 | 导出用户、star、反馈、订阅、报告、任务、Copilot、用量等；不包含 GitHub token、SMTP/模型密钥、推送 endpoint |
| 删除账号 | 设置页“隐私与数据” | 输入登录名确认后提交 | 登录用户 | 删除用户及级联数据；若 `ADMIN_LOGINS` 只有一个且是当前用户则阻止 |
| 退出登录 | 顶部导航 | 点击“退出” | 登录用户 | 只清会话；不会主动吊销 GitHub token |

### 2.2 雷达与发现

| 功能 | 入口 | 触发时机 | 可用身份 | 说明 |
| --- | --- | --- | --- | --- |
| 精选雷达 | `/feed` | 每次打开页面 | 登录用户 | 先展示“今天值得看的几件事”，再展示机会卡、隐藏宝石和工具库；主列表优先读 `feed_snapshots`，缺失/过期时实时排名并异步补建 |
| 雷达模式 | `/feed` 顶部 | 选择“综合 / 补项目 / 换工具 / 找灵感 / 看新东西” | 登录用户 | 写入用户偏好；不同模式影响机会卡和排序侧重 |
| 雷达人格 | `/feed` 顶部 | 页面加载时根据画像生成 | 登录用户 | 轻量的人格化文案，不是独立模型 |
| 机会卡 | `/feed` 顶部 | 页面加载；依赖最新维护周报、接入建议、关注命中 | 登录用户 | 最多 3 条，带“为什么给你看”的证据和下一步入口；可标记已完成/不感兴趣 |
| 隐藏宝石 | `/feed` | 页面加载；现场搜索或使用库内候选 | 登录用户 | 50–5000 stars、近 3 年创建、近 120 天有推送；排除大厂、awesome、教程、模板；支持“换一批”；展示过的进入 7 天冷却 |
| 隐藏宝石理由 | `/feed` 卡片 | 展开/查看 | 登录用户 | 给出“最近更新”“7 天 star 增长”“和你的栈相同”等证据 |
| 不感兴趣 | `/feed` 卡片 | 点击“不感兴趣”并选择原因 | 登录用户 | 原因包括太宽泛、官方库、不是我的栈、早知道、其他；会影响后续隐藏宝石筛选 |
| 工具库 | `/feed?tab=library` | 切换 tab | 登录用户 | 标签分组、语言/已验证/release/上升筛选、搜索、分页、release 更新 |
| 分数解释 | 工具库卡片 | 展开“为什么是这个分数” | 登录用户 | 展示质量、新鲜度、增速、个人匹配、反馈/订阅贡献 |
| 收藏 / 不感兴趣反馈 | 雷达卡片 | 点击按钮 | 登录用户 | 收藏提升相关 topic 权重；不感兴趣立即隐藏并降低 topic 权重 |
| 收藏集 | `/feed?tab=collections`、`/collections/[id]` | 创建、添加、移除、搜索、切换公开/私密、删除 | 登录用户；公开集合匿名可读 | 集合可公开分享；当前公开页通过自增 ID 访问 |
| 分享雷达 | `/feed` 顶部 | 点击“分享雷达” | 登录用户 | 生成 12 位随机 token 的只读快照 `/radar/[token]`；包含模式、人格、机会卡、隐藏宝石 |
| 公开雷达快照 | `/radar/[token]` | 访问分享链接 | 匿名 | 只读；当前没有过期时间、撤销入口或访问统计 |
| 意图搜索 | `/discover` | 输入一句话需求并提交 | 登录用户；需要模型 | LLM 解析关键词/语言/topic/必须能力/排除项 → 关键词+向量召回 → LLM 重排，返回“为什么匹配/缺口”；有缓存 |
| 项目详情 | `/r/[owner]/[name]` | 点击任意项目 | 匿名可看公开信息；登录后有“和你的关系” | 摘要、问题、适合谁、功能画像、star 走势、版本时间线、同类项目、收藏集、验证状态、AI 推断主题 |
| AI 功能画像 | 项目详情 | 点击“生成/重新生成功能画像” | 登录用户 + 基础 GitHub token + 模型 | 从 README/清单生成定位、能力、适合/不适合、快速上手；按 README hash 缓存 |
| AI 推断主题 | 项目详情 | 点击“AI 推断主题” | 登录用户 + 模型 | 生成 3–5 个 GitHub topic 风格标签，不覆盖 GitHub 原始 topics |
| 趋势页 | `/trends` | 打开页面 | 登录用户 | 7 天 star 增速、topic 动量、新项目、新库速度榜、本周新版本、AI 趋势简报 |
| AI 趋势简报 | `/trends` | worker 每 12 小时生成；页面读取 | 登录用户 | headline + 3–5 条观察 + 值得继续观察；没有模型时展示数据版 |
| 每日榜单 | `/daily` | 打开页面；worker 每日记录快照 | 登录用户 | 按当前 star − 上一次快照排 Top10；支持历史日期回看、官方框架过滤、复制/导图 |
| 趋势分享卡 | `/share/trending` | 从趋势页进入 | 登录用户；模型可选 | 近 7 天 star 增量 Top10 海报；AI 文案、复制文字、单张/全部 PNG、ZIP（PNG + 文案 + README） |
| 每日分享卡 | `/daily` | 打开每日榜单 | 登录用户 | 复用分享海报组件；按天缓存 AI 文案 |
| 旧地址兼容 | `/maintain`、`/integrations`、`/watch`、`/issue`、`/copilot`、`/history`、`/collections`、`/workbench` | 访问旧 URL | 登录用户/匿名视目标页 | 保留查询参数并重定向到新地址，避免历史通知、邮件和书签失效 |

### 2.3 工作台（AI 项目搭档）

| 功能 | 入口 | 触发时机 | 可用身份 | 说明 |
| --- | --- | --- | --- | --- |
| 工作台导航 | `/workbench/*` | 打开工作台 | 登录用户 | 维护、接入、换库、贡献、关注、周报、问雷达 7 个 tab |
| 维护周报 | `/workbench/maintain` | 点击“生成维护周报” | 登录用户 + `repo` scope + 模型 | 汇总维护中项目：健康度、依赖升级、Issue/PR 待办；最多 3 个项目；后台任务 |
| 健康度 | 维护周报 | 生成后展示 | 同上 | 测试、CI、Issue/PR 积压、维护活跃度、3–5 条本周动作 |
| 依赖升级检查 | 维护周报 | 生成周报时 | 同上 | 读取依赖清单和 lockfile，查询 npm/PyPI/Go/crates.io 最新版本和 OSV 安全公告；尝试读取 release notes |
| Issue/PR 待办 | 维护周报 | 生成周报时 | 同上 | 按“现在 / 本周 / 稍后”分组，给出处理建议和回复草稿 |
| 复制维护任务书 | 维护周报 | 点击“复制周报给 AI” | 登录用户 | 生成给 Claude Code / Cursor 的任务书 |
| 生成升级补丁 | 依赖升级条目 | 点击“生成升级补丁” | 登录用户 + `repo` scope + 模型/包管理器 | 在 Docker 沙箱中执行升级命令并跑构建/测试，返回含 lockfile 的 diff；失败也保留补丁和日志 |
| Issue 修复方案 | 维护周报 Issue 待办 | 点击“生成修复方案” | 登录用户 + `repo` scope + 模型 | 后台任务生成问题判断、可能文件、步骤、测试、风险、验收标准 |
| 修复补丁 | `/issue-plan` | 点击“生成修复补丁” | 登录用户 + `repo` scope + 模型 | 读取 Issue 和最多 8 个相关文件，生成 unified diff；在临时克隆中 `git apply --check`，再在 Docker 沙箱构建/测试 |
| 补丁详情 | `/patch/[id]` | 任务完成后进入 | 补丁所有者 | 改动说明、验证结果、完整日志、补丁内容、PR 描述草稿；可复制/下载 `.patch` |
| 接入建议 | `/workbench/integrations` | 点击“生成接入建议” | 登录用户 + 模型；token 可选 | 以维护中项目为起点，找“缺失能力”或“可优化”候选；生成理由、步骤、风险和任务书 |
| 维护项目管理 | 接入页 | 添加 `owner/repo`、切换活跃、移除 | 登录用户 | 手动添加的项目不在库内时会尝试用 GitHub token 拉取 |
| 接入结果标记 | 接入页 | 点击“已接入 / 不感兴趣”、填写执行记录 | 登录用户 | 已采纳/已拒绝会影响后续生成；执行记录可填 PR、commit、安装版本或备注 |
| 接入回访 | 接入页 | worker 每 6 小时检查已接入库的新版本 | 登录用户 | 新版本、安全公告写入回访记录和通知 |
| 选型对比 | 接入页项目卡片 | 点击“对比候选” | 登录用户 + `repo` scope + 模型 | 对比目标项目和候选的适配度、优势、弱点、迁移成本、推荐项和验证步骤 |
| 单库重新生成 | 接入页 | 点击“重新生成这个库” | 登录用户 + `repo` scope + 模型 | 只重跑一个项目的接入建议 |
| 接入预演 | 接入建议卡片 | 点击“试接入” | 登录用户 + `repo` scope + 模型 | 在 Docker 沙箱里加依赖、可写最小接线、安装/构建，保存 diff/命令/日志；不改远端 |
| 相似项目对比 | `/workbench/maintain/similar` | 选择项目后点击“开始对比” | 登录用户；token 可选 | 从项目描述和 README 提取关键词，找已收录候选 + GitHub 现场搜索，再让模型对比优劣、可借鉴设计和照搬风险 |
| 换库沙盘 | `/workbench/swap` | 填写项目 + 旧包 + 新包，点击生成 | 登录用户 + `repo` scope；模型或机械模式 | 生成迁移补丁，在沙箱验证安装/构建；机械模式用 Babel 做确定性 import/require 替换 |
| 贡献雷达 | `/workbench/contribute` | 打开页面 | 登录用户；读取 Issue 需要 token | 用维护项目找技术栈相近的仓库，再筛 `good first issue` / `help wanted`，点击进入 Issue 方案流程 |
| 关注代理 | `/workbench/watch` | 创建意图、点击“运行匹配” | 登录用户 + 模型；GitHub token 可选 | 一句话描述长期关注；AI 从候选池判断匹配度，有 token 时提取关键词现场搜索；结果写入通知 |
| 关注命中处理 | 关注页 | 点击“已完成 / 不感兴趣” | 登录用户 | 处理后的命中不再出现在后续列表 |
| 问雷达 Copilot | `/workbench/copilot` | 发送消息 | 登录用户 + 模型 + Copilot 配额 | 读取维护项目、维护周报、接入建议、关注代理和历史记录；多会话、新建、删除、重新生成；不声称执行代码或开 PR |
| Copilot 快捷动作 | Copilot 页 | 点击按钮 | 登录用户 | 直接排维护周报或接入建议后台任务 |
| 技术周报 | `/workbench/issue` | 打开页面/生成 | 登录用户 + 模型 | 生成技术周报选题和 Markdown/HTML 草稿；模型只输出结构化 JSON，渲染和仓库引用校验在本地完成 |
| 技术周报草稿页 | `/workbench/issue` | 生成后 | 登录用户 | 展示草稿、复制/下载；历史版本可回看 |
| 选型对比详情 | `/compare` | 从接入页/发现页进入 | 登录用户 | 展示对比报告、能力差异、验证步骤、推荐项 |
| Issue 方案详情 | `/issue-plan` | 从维护周报/贡献雷达进入 | 登录用户 | 问题判断、可能文件、步骤、测试、风险、补丁列表 |
| 任务跳转 | 各生成按钮 | 点击后立即跳 `/tasks` | 登录用户 | 后台执行，不阻塞浏览 |

### 2.4 仓库管理与曝光优化

| 功能 | 入口 | 触发时机 | 可用身份 | 说明 |
| --- | --- | --- | --- | --- |
| 仓库列表 | `/repos` | 打开页面 | 登录用户 + 可读取 GitHub token | 展示自己的仓库、公开/私有、归档、Fork、star、更新时间；使用登录用户 token 或环境 token |
| 仓库授权 | `/repos` | 点击“授权仓库管理” | 登录用户 | 重新走 OAuth 申请 `repo`；删除时再单独申请 `delete_repo` |
| 批量新建 | `/repos` | 点击“新建仓库” | 登录用户 + `repo` | 一次最多 10 个；共用描述、可见性、`.gitignore`、许可证、是否自动初始化 |
| 单仓编辑/改名 | `/repos` | 点击“编辑” | 登录用户 + `repo` | 改仓库名、描述、可见性、归档状态 |
| 批量修改 | `/repos` | 勾选后点击“批量修改” | 登录用户 + `repo` | 统一改描述、清空描述、可见性、归档状态；一次最多 20 个 |
| 批量删除 | `/repos` | 勾选后点击“批量删除” | 登录用户 + `delete_repo` | 必须勾选确认；不可恢复；一次最多 20 个 |
| 曝光优化 | `/repos/[owner]/[name]/optimize` | 点击“曝光优化”或直接访问 | 登录用户 + `repo` + 模型 | 从定位清晰度、搜索关键词、README 首屏、差异化、信任信号五个维度体检 |
| 优化建议写回 | 曝光优化页 | 点击确认应用 | 登录用户 + `repo` | 可写回 GitHub 描述和 Topics；README 不会自动修改 |
| 评分历史 | 曝光优化页 | 页面加载 | 登录用户 | 展示历史曝光报告和分数变化 |

### 2.5 任务、收件箱与建议库

| 功能 | 入口 | 触发时机 | 可用身份 | 说明 |
| --- | --- | --- | --- | --- |
| 任务中心 | `/tasks` | 打开页面/任何生成操作后 | 登录用户 | 查看排队、运行、成功、失败、取消；状态筛选、分页、结果入口 |
| 任务进度 | `/tasks` | 任务运行中 | 登录用户 | 显示当前进度文案；页面自动刷新 |
| 取消任务 | `/tasks` | 点击“取消” | 任务所有者 | 排队任务立即取消；运行中任务标记取消，执行器在安全点停止 |
| 重试任务 | `/tasks` | 失败/取消后点击“重试” | 任务所有者 | 重置尝试次数并重新入队；受配额限制 |
| 任务配额提示 | `/tasks?quota=...` | 创建任务被配额拒绝 | 登录用户 | 显示拒绝原因 |
| 收件箱 | `/inbox` | 打开页面 | 登录用户 | 全部 / GitHub / AI 工作 / 版本 / 系统分类；只看未读、分页、单条/全部标记已读 |
| GitHub 动态同步 | 收件箱 | 点击“同步 GitHub 动态”；进入收件箱超过 6 小时自动排一次；应用打开每 5 分钟心跳，实际 15 分钟一次 | 登录用户 + GitHub token | 检查维护中仓库的新 star、fork、打开的 Issue/PR、release；第一次只建基线 |
| Webhook 实时动态 | `/api/github/webhook` | GitHub 推送事件 | GitHub 签名 | 需要管理员配置 Secret；实时写 star/fork/Issue/PR/release |
| 通知偏好 | 设置页“通知” | 保存时 | 登录用户 | 分别开关 star/fork/Issue/PR/release；邮件、浏览器推送、每周精选 |
| 通知邮箱 | 设置页“通知” | 保存时 | 登录用户 | 留空回退 GitHub 邮箱 |
| 浏览器推送 | 设置页“通知” | 点击“允许此设备接收推送” | 登录用户，非演示 | 保存 Web Push 订阅；可发送测试推送；VAPID 密钥自动生成并加密 |
| 邮件通道 | 设置页“邮件通道” | 管理员保存配置/发送测试 | 管理员 | 支持 QQ、163、Gmail、自定义 SMTP；密码加密保存 |
| 建议库 | `/library` | 打开页面 | 登录用户 | 接入建议、关注命中、维护待办、选型对比、曝光优化、历史报告 6 个 tab |
| 建议按库汇总 | `/library?tab=integration` 等 | 打开 tab | 登录用户 | 显示出现次数、涉及项目、已接入、不感兴趣、待处理；支持按库/按项目切换 |
| 历史报告 | `/library?tab=history` | 打开 tab | 登录用户 | 按类型、分页回看具体报告；支持 `?report=` / `?draft=` / `?plan=` 定位 |
| 历史导出 | 建议库/设置页 | 点击导出 | 登录用户 | 默认导出索引元数据；`/api/history/export?full=1` 包含完整报告、周报 HTML、补丁和周报记录 |
| 已处理状态 | 雷达/接入/维护/关注/隐藏宝石 | 标记已接入/已完成/不感兴趣 | 登录用户 | 标记后不再出现在后续推荐；依赖完成状态绑定到具体目标版本 |

### 2.6 设置、管理员与运维

| 功能 | 入口 | 触发时机 | 可用身份 | 说明 |
| --- | --- | --- | --- | --- |
| GitHub 授权状态 | 设置页 | 页面加载 | 登录用户 | 显示登录账户、token 有效性、实际 scope、是否含 `repo` / `delete_repo` |
| 重新授权 | 设置页/仓库页 | 点击授权 | 登录用户 | 申请 `repo` 或 `delete_repo` |
| AI 模型配置 | 设置页“AI 模型” | 管理员保存/清除/测试 | 管理员 | 8 家服务商、45 个预置模型，也可手填；Key 加密保存；环境变量优先 |
| 模型连接测试 | 设置页“AI 模型” | 点击“测试模型连接” | 管理员 | 发送最小请求，返回成功/失败和 HTTP 状态 |
| 候选池刷新 | 设置页“候选池” | 管理员点击“刷新候选池” | 管理员 | 后台任务；消耗 GitHub Search 限额和模型额度 |
| 候选池富化 | 设置页“候选池” | 管理员点击“富化待处理仓库” | 管理员 | 仅补 README 和模型摘要，不重新采集 |
| 站点地址 | 设置页“站点地址” | 管理员保存 | 管理员 | 用于邮件链接和 Webhook 完整 URL；环境变量优先 |
| 限流与配额 | 设置页“限流与配额” | 管理员保存/恢复默认 | 管理员 | 每日 AI 调用/token、全站 token 预算、每小时/每日任务数、排队上限、Copilot 消息数、每日投递数、AI 总开关 |
| 数据保留与清理 | 设置页“数据保留” | 管理员保存/立即清理 | 管理员 | 已读通知、投递、任务、动态、用量、采集、验证、Copilot、生成内容；0 表示永久 |
| AI 用量 | 设置页“AI 用量” | 页面加载 | 登录用户 | 近 30 天调用次数、tokens、按模型拆分 |
| 口味画像 | 设置页“口味画像” | 页面加载/点击标签 | 登录用户 | 展示 topic/语言权重；点击排除/恢复；高级手动编辑 |
| 订阅规则 | 设置页“订阅规则” | 添加/移除 | 登录用户 | topic / language / author 提升排序；release 追踪版本 |
| 同步画像 | 设置页“同步画像” | 点击“重新同步” | 登录用户 + token | 重新读取最近 star、活跃仓库、公开事件 |
| 隐私与数据 | 设置页“隐私与数据” | 页面加载 | 登录用户 | 导出数据、隐私说明、服务条款、删除账号 |
| GitHub OAuth 应用 | 设置页“OAuth” | 管理员更新/清除 | 管理员 | 数据库配置可改；环境变量配置只读 |
| 演示数据 | 设置页“演示数据” | 本地开发模式点击 | 本地开发用户 | 把高分项目当作 star 生成口味画像 |
| 运维面板 | `/ops` | 打开页面 | 管理员 | 任务、投递、token 用量、数据库大小、最近失败、验收检查、AI 任务质量、AI 成本、模型单价、告警配置、最近告警 |
| Prometheus 指标 | `/api/metrics` | Prometheus 抓取 | Bearer token | 未配置 `METRICS_TOKEN` 返回 404 |
| 健康检查 | `/api/health` | 容器/负载均衡探针 | 匿名 | 检查数据库连通性 |
| 错误上报 | `instrumentation.ts`、`/api/client-errors` | 服务端未捕获错误/浏览器错误 | 服务端/浏览器 | 结构化日志；配置 `ERROR_WEBHOOK_URL` 后额外转发 |
| 告警 | worker 每 5 分钟检查 | 失败任务、失败投递、队列积压、心跳超时 | 管理员配置 | 按冷却时间发送邮件；收件人可配置，留空发给管理员通知邮箱 |
| 数据库迁移 | `pnpm radar migrate` / compose migrate | 启动/手动 | 运维 | 应用 0001–0016 迁移 |
| 验收检查 | `/ops`、`pnpm radar doctor` | 手动 | 管理员/运维 | 检查数据库、pgvector、迁移、候选池、模型/Embedding 覆盖率、GitHub 授权、邮件、站点地址、任务队列 |

### 2.7 后台自动化、API、MCP 与 CLI

#### 2.7.1 Worker 定时循环

| 循环 | 实际频率 | 作用 | 触发对象 |
| --- | --- | --- | --- |
| AI 任务队列 | 每 2 秒轮询 | 执行 `ai_jobs`；每组用户最多 2 个并发；10 分钟超时；失败自动重试一次；15 分钟心跳回收 | 所有用户任务 |
| 投递队列 | 每 5 秒 | 发送邮件/浏览器推送；失败按退避重试 | 有 pending delivery 的用户 |
| GitHub 动态 | 每 15 分钟 | 同步维护中仓库的 star/fork/Issue/PR/release | 有 GitHub token 的用户 |
| Release 检查 | 每 15 分钟 | 检查 release 订阅仓库最新版本 | release 订阅用户 |
| 每周精选 | 每 30 分钟检查 | 为开启 `weeklyDigest` 且有通知邮箱的用户排队每周摘要 | 画像用户 |
| 候选池自动刷新 | 每 10 分钟检查，实际至少间隔 6 小时 | 采集 + 富化新仓库；advisory lock 防多 worker 重复 | 全站 |
| 数据保留清理 | 每 30 分钟检查，实际最多 24 小时一次 | 清理过期数据 | 全站 |
| Feed 快照 | 每 30 分钟，最多 20 个用户 | 为有画像用户重算主列表快照（最多 300 条） | 有画像用户 |
| 接入回访 | 每 6 小时 | 检查已接入库的新版本和安全公告 | 已接入用户 |
| 趋势简报 | 每 12 小时 | 用模型生成趋势简报 | 全站 |
| 每日快照/榜单 | 每个循环都检查，实际每天一次 | 记录 star 快照并持久化每日榜单 | 全站 |
| 告警检查 | 每 5 分钟 | 评估失败任务、投递积压、心跳超时 | 管理员 |

#### 2.7.2 MCP 工具（20 个）

| 分类 | 工具 | 作用 | 是否写库 |
| --- | --- | --- | --- |
| 搜索/推荐 | `search_repos` | 按关键词/topic/语言搜索已富化项目 | 否 |
| 搜索/推荐 | `get_recommendations` | 基于画像、反馈、订阅返回个性化推荐 | 否 |
| 搜索/推荐 | `get_digest` | 生成 Markdown 摘要 | 否 |
| 搜索/推荐 | `list_rising` | 近 7 天增速最快项目 | 否 |
| 搜索/推荐 | `list_release_updates` | 关注仓库的最新 release | 否 |
| 搜索/推荐 | `find_repos` | 自然语言意图搜索 | 否 |
| 搜索/推荐 | `explain_repo` | 返回仓库功能画像 | 否 |
| 项目/建议 | `get_repo` | 仓库摘要、评分、最近验证 | 否 |
| 项目/建议 | `get_recommendation_library` | 按库/条目汇总历史建议 | 否 |
| 项目/建议 | `get_pending_work` | 未处理接入、维护、关注命中 | 否 |
| 项目/建议 | `pick_library` | 按任务选库 | 否 |
| 项目/建议 | `integration_preflight` | 最近一次试接入结果 | 否 |
| 项目/建议 | `similar_diff` | 能力矩阵 | 否 |
| 项目/建议 | `get_trends` | 最近趋势简报 | 否 |
| 反馈/订阅 | `record_feedback` | 写入收藏/不感兴趣 | 是 |
| 反馈/订阅 | `add_subscription` | 添加 topic/language/author/release 订阅 | 是 |
| 任务 | `generate_integration_preflight` | 触发接入预演 | 是（排任务） |
| 任务 | `generate_comparison` | 触发选型对比 | 是（排任务） |
| 任务 | `generate_swap_trial` | 触发换库预演 | 是（排任务） |
| 任务 | `get_job_status` | 查询任务状态和结果链接 | 否 |

#### 2.7.3 CLI 命令（17 个）

`migrate`、`ingest`、`enrich`、`list`、`digest`、`issue`、`verify`、`rising`、`releases`、`activity`、`mcp`、`pipeline`、`doctor`、`infer-topics`、`snapshot`、`backfill-identities`、`demo-seed`。

#### 2.7.4 API 路由（18 个）

- 认证：`/api/auth/[...nextauth]`
- 健康/指标：`/api/health`、`/api/metrics`
- 账号：`/api/account/export`
- 设置：`/api/settings/webhook-secret`
- 机器人/搜索：`/api/copilot`、`/api/search`
- 任务：`/api/jobs`
- 动态：`/api/activity/sync`、`/api/github/webhook`
- 推送：`/api/push/public-key`、`/api/push/subscribe`、`/api/push/unsubscribe`、`/api/push/test`
- 导出/内容：`/api/history/export`、`/api/issues/[id]`、`/api/patches/[id]`
- 错误：`/api/client-errors`

---

## 3. 功能逻辑问题

按严重程度分级。P0 建议在继续加功能前先修；P1 建议在下一轮迭代修；P2 是体验/一致性问题。

### 3.1 P0：安全与数据一致性

| ID | 问题 | 证据 | 影响 | 建议 |
| --- | --- | --- | --- | --- |
| P0-1 | 演示账号的“只读”没有全面落地 | `apps/web/app/(app)/feed/actions.ts`（反馈、不感兴趣、标记完成、雷达模式、分享）没有 `assertWritable`；`apps/web/app/(app)/workbench/copilot/actions.ts` 没有；`app/api/copilot/route.ts` 没有；`app/(app)/workbench/watch/actions.ts` 的创建/删除意图没有；`app/(app)/compare/actions.ts`、`issue-plan/actions.ts`、`maintain/actions.ts` 的旧 AI action 也没有 | 演示账号可以写反馈、改偏好、创建分享快照、创建关注意图、消耗模型额度；与页面横幅“演示账号只读”不一致 | 在鉴权层统一：所有写 action/API 都走 `assertWritable`，或者把 `assertWritable` 下沉到 `withUser/withAdmin` 包装器，避免逐文件遗漏 |
| P0-2 | 演示账号可能成为管理员 | `apps/web/lib/admin.ts`：`ADMIN_LOGINS` 为空时取 `ORDER BY id LIMIT 1`；`demo-radar` 通过 Credentials 创建时没有排除管理员判定；`requireAdmin()` 不拦截 demo | 空库演示部署中，第一个登录的演示账号可能获得 `/ops` 和全局配置写权限；`saveLlmConfigAction`、`saveMailConfigAction` 等只调用 `requireAdmin`，没有 `assertWritable` | `isAdminUser` 明确对 `demo-radar` 返回 false；生产环境强制配置 `ADMIN_LOGINS`；管理员写操作统一加只读检查 |
| P0-3 | GitHub access token 被挂到 session 对象上 | `apps/web/auth.ts` 的 `session` callback 把 `accessToken`、`githubScope` 写到 `session`；Auth.js 的 `/api/auth/session` 会返回 session 对象 | token 可能随 session JSON 下发到浏览器；一旦有 XSS，攻击者可直接拿到 GitHub token。服务端 `auth()` 是需要的，但不应该把 token 暴露到 session payload | 把 token 只保存在 JWT/local 数据库，通过服务端专用函数读取；session 只暴露 `id/login/avatarUrl` |

### 3.2 P1：核心逻辑与性能

| ID | 问题 | 证据 | 影响 | 建议 |
| --- | --- | --- | --- | --- |
| P1-1 | Release 订阅通知绕过用户的 Release 偏好 | `packages/core/src/notifications.ts` 的 `notifyReleaseSubscribers` 直接插入通知并排队投递，没有读取 `githubRelease`；轮询路径 `activity.ts` 和 Webhook 路径 `webhook.ts` 会检查 | 用户关闭“Release 仓库发布新版本”后，只要订阅了 release，站内通知仍会产生；若同时开启邮件/推送，也会继续投递 | 在 `notifyReleaseSubscribers` 里读取 `loadNotificationPrefs`，尊重 `githubRelease`；同时明确“release 订阅”和“release 通知”是两个开关的产品语义 |
| P1-2 | Webhook 与轮询会重复通知同一事件 | Webhook 用 GitHub `x-github-delivery` 作为 `external_id`；轮询用 GitHub event `id` 作为 `activity.key` | 配置 Webhook 后，同一次 star/fork/Issue/release 可能在轮询时再通知一次 | 用与来源无关的去重键（如 `repo + kind + actor + created_at` 或 GitHub event id）统一 `activity_seen`；或者在启用 Webhook 时降低/关闭轮询 |
| P1-3 | Feed 快照与后续反馈不同步，过滤后页数会变短 | `packages/core/src/feed-snapshots.ts` 在构建快照时会用 feedback/hidden/excluded 排名，但用户之后新增隐藏/排除不会立即重建快照；页面取快照前 30 条后再 `rankForUser` 过滤 `score < 0` | 用户连续隐藏很多项目后，第一页可能不足 30 条；「加载更多」也可能出现空洞 | 在反馈/偏好写入时标记快照失效；或页面读取时从快照继续向后补足到目标条数，而不是只取前 N 条 |
| P1-4 | 快照新鲜度和 worker 刷新能力不匹配 | `FEED_SNAPSHOT_MAX_AGE_MINUTES = 60`；worker 每 30 分钟只处理 `listUsersNeedingFeedSnapshot(pool, 20)` 个用户 | 活跃用户超过约 40 人后，部分用户快照会超过 60 分钟，页面回退实时排名；用户越多，回退越频繁 | 按用户活跃度/最近访问时间加权；增加批量上限或只刷新 60 分钟内会访问的用户；快照写入后记录版本 |
| P1-5 | 每日快照循环每个循环都查两次数据库 | `apps/worker/src/worker.ts` 的 `scheduledDailySnapshots()` 没有时间戳 guard，被 `loop()` 每 2 秒调用一次；内部每次都 `SELECT count(*) ... star_snapshots` 和 `SELECT 1 ... daily_rankings` | 空闲时每天约 8 万次无意义查询；数据库压力随 worker 数量线性增加 | 加 `lastDailySnapshotCheckAt`，例如 10 分钟检查一次；或在启动时算好下一次执行时间 |
| P1-6 | 趋势简报也每个循环查一次最新报告 | `scheduledTrendBrief()` 没有时间戳 guard，每 2 秒 `loadTrendReport` 检查是否超过 12 小时 | 类似 P1-5，属于可避免的常数开销 | 加 30 分钟/1 小时的检查间隔 |
| P1-7 | 分享快照没有生命周期管理 | `packages/core/src/radar-snapshots.ts` 只生成 12 位 token，没有过期时间、撤销、访问统计；`/radar/[token]` 匿名可读 | 用户分享后无法撤回；包含登录名、项目机会、隐藏宝石等信息；长期暴露 | 增加 `expires_at`、`revoked_at`、创建者撤销入口、访问计数；默认 30/90 天过期 |
| P1-8 | 最后一个管理员的删除保护只在 `ADMIN_LOGINS` 恰好 1 人时生效 | `app/actions.ts` 的 `deleteAccountAction`：`if (admins.length === 1 && admins[0] === ...)`；未配置 `ADMIN_LOGINS` 时 `admins.length === 0`，检查被跳过 | 默认部署下管理员可以删除自己，下一位最早用户自动成为管理员；不是“最后一个管理员保护”，而是“管理员身份漂移” | 删除前查询当前实际管理员集合；或者禁止删除唯一管理员；明确未配置时的管理员继承规则 |
| P1-9 | 分享/返回地址只校验 `startsWith('/')` | `safeReturnTo`、`signInGithubAction`、部分 `returnTo` 处理；`//evil.com` 也以 `/` 开头 | 可能存在开放重定向；取决于 Next.js/Auth.js 对协议相对 URL 的处理，需要安全测试确认 | 统一用 `new URL(value, base)` 校验同源，拒绝 `//`、`\\`、换行和绝对 URL |
| P1-10 | 旧同步 AI 流程与新任务队列并存 | 页面未引用：`app/actions.ts` 的 `generateIntegrationAction`、`generateIssueAction`；`app/(app)/compare/actions.ts`、`issue-plan/actions.ts`、`maintain/actions.ts` 整组 action；`workbench/watch/actions.ts` 的 `runWatchIntentAction` | 维护两套实现、两套错误处理、两套配额调用；安全审计容易漏掉旧入口；代码体积和理解成本增加 | 删除未被引用的旧 action 和文件；页面只保留 `enqueue*Action` 任务队列路径 |
| P1-11 | 单进程内存限流不适合多实例 | `apps/web/lib/rate-limit.ts` 明确是单进程滑动窗口 | 多实例部署时搜索、导出、测试推送的限流会被绕过；文档已提示但生产容易踩坑 | 抽成 Redis/Postgres 限流；至少在部署文档和 health 里标记单实例假设 |
| P1-12 | 配额并发会轻微超额 | 配额在任务入队/模型调用前检查，token 用量在调用后入库；文档已承认 | 并发请求可能超过每日 token 上限；公开实例成本不可控 | 预留 buffer、调用前预扣估算 token、或对高成本任务做全局信号量 |
| P1-13 | `/ops` 的 Prometheus 链接缺少 token | `app/(app)/ops/page.tsx` 中 `<a href="/api/metrics">`；配置 `METRICS_TOKEN` 后接口要求 Bearer | 管理员点击链接得到 401，误以为指标坏了 | 页面不直接链接到受保护接口，或提供“复制抓取命令/带 token 的说明”；不要把 token 拼进 URL |
| P1-14 | 通知只有“全局邮件/推送”开关，没有按类别路由 | `saveNotificationPrefsAction` 只有 `emailNotifications` / `pushNotifications`；`queueNotificationDeliveries` 对所有通知统一处理 | 用户想“Release 发邮件、star 只站内”无法配置；只能全开/全关 | 做成类别 × 渠道矩阵：star/fork/Issue/PR/release/AI 任务/每周精选 × 站内/邮件/推送 |
| P1-15 | 数据保留默认永久保留 AI 内容和 Copilot | `DEFAULT_RETENTION_CONFIG` 中 `copilotDays: 0`、`generatedContentDays: 0` | 与隐私预期不一致；长期运行数据库膨胀；旧报告含私有项目信息 | 首次部署给出显式选择；提供“推荐保留期”预设；导出/删除入口更醒目 |

### 3.3 P2：体验、文档与可维护性

| ID | 问题 | 证据 | 影响 | 建议 |
| --- | --- | --- | --- | --- |
| P2-1 | 工作台/建议库/设置页信息层级过深 | 工作台 7 tab、建议库 6 tab、设置 15 分区 | 新用户找不到功能；功能发现依赖“记住路径” | 重排为 3 个主域：雷达 / 项目工作台 / 仓库与设置；把低频功能收进二级 |
| P2-2 | 文档与实现漂移 | `/workbench/watch` 页面文案写“前 180 个候选”，worker `watchJob` 实际 `findEnrichedRepos(pool, 140)` 并最多扩到 160；FEATURES 文档也写 180 | 用户/贡献者对行为预期不一致 | 把候选数量抽成常量/配置，文档引用同一常量；补一条“参数来源”说明 |
| P2-3 | 旧地址兼容页长期存在 | 8 个 `page.tsx` 仅做 `redirectLegacy` | 路由表膨胀、构建产物增加；新贡献者容易误以为有独立页面 | 保留一个发布周期的 301/307 后删除；或在 Next 配置里统一重定向 |
| P2-4 | 任务页在 GET 时执行 `recoverStaleJobs` | `app/(app)/tasks/page.tsx` 每次打开都调用 `recoverStaleJobs` | 读请求产生写操作；多用户同时打开可能产生锁竞争 | 由 worker 定时回收；页面只读；需要时提供“手动回收”按钮 |
| P2-5 | 旧“已 star / 已收藏”状态缺少撤销说明 | `submitFeedbackAction` 再次点击会取消，但 UI 没有明确提示 | 用户不确定点击是切换还是单向操作 | 在按钮 title/aria-label 里写“再次点击取消”；或改成明确的“取消收藏” |
| P2-6 | 机会卡/隐藏宝石/工具库三套排序解释不统一 | 机会卡用 opportunity priority，隐藏宝石用 gem score，工具库用 personalized score | 用户会问“为什么这个在精选、那个在工具库分数更高” | 统一一个“推荐解释”组件，至少展示信号来源和所属池子 |
| P2-7 | 公开收藏集使用自增 ID | `/collections/[id]`，公开集合匿名可读 | ID 可枚举；虽然不是敏感数据，但不利于分享和权限控制 | 公开集合使用随机 slug/token；或明确“公开即可枚举”的产品语义 |
| P2-8 | 分享卡依赖客户端渲染和第三方库 | `TrendingPoster` 使用 `html-to-image` + `jszip` | 低性能设备/严格 CSP 下可能导出失败；没有服务端渲染兜底 | 增加“服务端生成 PNG”或失败提示；至少做一次跨浏览器验收 |
| P2-9 | 文档中的 MCP 工具表不完整 | FEATURES 只列了 10 个工具，代码有 20 个 | 用户不知道 `generate_*`、`get_job_status` 等能力 | 文档由代码生成或补全表格；在 MCP server 里提供 `list_tools` 说明 |
| P2-10 | 错误提示大量使用 `?error=xxx` 查询参数 | 各工作台页面 | 刷新后错误提示不消失；URL 被污染；难以区分“上次错误”和“当前错误” | 用一次性 flash/toast；或读取后清除查询参数 |
| P2-11 | `Link` 与 `<a>` 混用 | 多处外链使用 `<a>`（合理），但内部跳转也有 `<a className="btn">` | 内部跳转失去 Next 预取和客户端导航 | 统一内部 `Link`、外部 `<a target="_blank" rel="noreferrer">` |
| P2-12 | 管理员缺少用户管理能力 | `/ops` 只展示用户概览 | 无法禁用滥用用户、提升管理员、查看单用户用量 | 增加用户列表、角色、禁用、用量、任务、审计入口 |

---

## 4. 哪些功能该删、该并、该收

> 原则：删除“重复实现”和“低价值入口”，保留“能形成差异化证据链”的能力。下面的“删除”多数是删除代码路径或合并入口，不一定要删除底层能力。

### 4.1 建议直接删除（代码层）

| 对象 | 原因 | 建议 |
| --- | --- | --- |
| `app/actions.ts` 中 `generateIntegrationAction`、`generateIssueAction` | 页面未引用；与任务队列重复；旧实现缺少统一的进度/取消/重试 | 删除，保留 `enqueue*Action` |
| `app/(app)/compare/actions.ts` 整组 `generateComparisonAction` | 页面未引用；对比已走 `enqueueComparisonAction` | 删除文件 |
| `app/(app)/issue-plan/actions.ts` 整组 `generateIssuePlanAction` | 页面未引用；方案已走 `enqueueIssuePlanAction` | 删除文件 |
| `app/(app)/workbench/maintain/actions.ts` 整组 `generateMaintainerAction` | 页面未引用；周报已走 `enqueueMaintainerAction` | 删除文件 |
| `app/(app)/workbench/watch/actions.ts` 的 `runWatchIntentAction` | 页面未引用；运行匹配已走 `enqueueWatchRunAction` | 删除函数；保留创建/删除意图 |
| 8 个 `redirectLegacy` 兼容页 | 增加路由面积；发布一段时间后旧链接可由反向代理/Next 配置统一处理 | 一个发布周期后删除，或在 `next.config` 集中重定向 |

### 4.2 建议合并入口（保留能力）

| 合并项 | 当前问题 | 建议 |
| --- | --- | --- |
| 趋势 + 每日榜单 + 分享卡 | 三个页面共享“7 天/每日 star 增量 + 海报 + AI 文案”，用户要来回跳 | 合并为 `/trends` 下的三个视图：趋势 / 每日榜 / 分享卡；数据口径统一展示 |
| 接入预演 + 换库沙盘 | 都是“生成补丁 → 沙箱验证 → 补丁详情”，只是输入不同 | 合并为“沙箱预演”入口，内部两种模式：新增依赖 / 替换依赖 |
| 贡献雷达 + 相似项目 + Issue 方案 | 贡献雷达本质是“相似项目 + good first issue”，后面复用 Issue 方案 | 贡献雷达作为相似项目页的一个筛选视图；减少一个一级 tab |
| 维护周报 + 依赖升级 + Issue 待办 | 三者已经在一个页面，但入口和结果分散 | 保持一个页面，增加“按项目 / 按优先级 / 按类型”三个视图，而不是继续加卡片 |
| 建议库 6 个 tab | 接入、关注、维护、对比、曝光、历史并列，认知负担高 | 一级只留“按库 / 按项目 / 历史”；类型用筛选器 |
| 工作台 7 个 tab | 维护、接入、换库、贡献、关注、周报、问雷达 | 合并为“项目（维护/接入/相似） / 沙箱（预演/换库） / 内容（周报/分享） / 助手（Copilot）”，关注代理收进项目 |

### 4.3 建议降级/观察（不立即删除）

| 功能 | 理由 | 建议 |
| --- | --- | --- |
| 技术周报 `/workbench/issue` | 面向 P3 内容创作者，和 P1/P2 的核心工作流距离较远；但它是“内容分发”差异化的素材来源 | 保留但降级到“内容”二级页；观察使用率，若长期低使用则改为 CLI/定时任务，不做独立一级入口 |
| 曝光优化 | 和仓库管理强相关，但入口在仓库列表里，用户不容易发现 | 保留能力，移动到“仓库”主域；在仓库卡片上直接显示“可发现性分数” |
| 贡献雷达 | 对开源贡献者是亮点，但对“维护自己项目”的主用户是次要需求 | 保留为相似项目页的筛选视图，不单独占工作台 tab |
| 演示账号 | 对托管 demo 很有价值，但安全边界复杂 | 保留，但默认关闭；托管 demo 必须显式设置 `ADMIN_LOGINS`，并强制 demo 只读 |
| 旧 `/history` 等兼容路由 | 历史通知/邮件可能还在用 | 保留 1–2 个发布周期，之后用统一重定向替换 |

---

## 5. 现有功能可以怎么扩展

### 5.1 雷达与发现

| 现有功能 | 扩展方向 | 价值 |
| --- | --- | --- |
| 隐藏宝石 | 增加“为什么没推荐”解释；允许“换一批”时保留已看过但未处理的项；按语言/主题锁定 | 降低“刷不到想看的东西”的挫败感 |
| 不感兴趣 | 增加“撤销”和“调整原因”；把原因映射到可见的 topic/语言权重变化 | 让反馈闭环可感知，而不是黑盒 |
| 工具库 | 增加“对比勾选”与“加入收藏集”批量操作；按维护状态/许可证/测试覆盖筛选 | 从“看”到“选型”更顺 |
| 机会卡 | 支持“稍后提醒”；把“已完成”变成可回看的时间线 | 形成个人工作流，而不是一次性推荐 |
| 收藏集 | 公开集合增加随机 slug、封面、排序、描述模板；支持克隆别人的集合 | 低成本获得内容分享和社区传播 |
| 分享雷达 | 增加过期时间、撤销、访问统计、密码/登录可见、自定义封面 | 解决隐私顾虑，才敢分享 |
| 意图搜索 | 支持多轮追问、结果内“再筛”、保存为关注代理、保存搜索历史 | 把“一次搜索”变成长期需求 |
| 项目详情 | 增加依赖健康、许可证风险、维护者响应时间、breaking change、替代品对比 | 从“介绍页”升级为“选型决策页” |
| 趋势页 | 增加“按你的栈过滤”的趋势；允许只看已 star/已接入项目的生态变化 | 从公共趋势变成个人趋势 |

### 5.2 工作台

| 现有功能 | 扩展方向 | 价值 |
| --- | --- | --- |
| 维护周报 | 接入 GitHub Projects/Linear/Jira；把建议动作变成可勾选任务；支持团队共享 | 从“报告”变成“周工作流” |
| 依赖升级 | 增加 breaking change 摘要、迁移指南、回滚建议；支持一次升级多个包 | 提高真实维护效率 |
| Issue 方案/补丁 | 增加“按仓库规范生成测试”“生成 PR 描述”“生成 changelog”；仍不自动合并 | 保持人工审阅边界，同时减少重复劳动 |
| 接入建议 | 增加“成本/收益/风险”评分；支持“只接受 MIT/ Apache”“只要活跃维护”等硬约束 | 让建议更可执行 |
| 相似项目 | 增加“能力矩阵差异图”和“可借鉴代码位置”；支持导出为架构决策记录（ADR） | 对技术选型者更有说服力 |
| 换库沙盘 | 增加迁移风险评估、回滚补丁、逐步迁移计划；支持 monorepo | 从 demo 变成可落地的迁移工具 |
| 关注代理 | 支持定时运行、频率设置、命中后自动生成对比/接入建议 | 从手动按钮变成真正的“代理” |
| Copilot | 接入代码索引，支持“读我的仓库代码回答”；增加引用来源和“我不知道”边界 | 从报告问答升级为项目搭档 |
| 技术周报 | 增加多平台模板（公众号/小红书/Newsletter）、排期、素材库 | 服务内容创作者 |

### 5.3 仓库、通知与治理

| 现有功能 | 扩展方向 | 价值 |
| --- | --- | --- |
| 仓库管理 | 增加仓库健康分、README 检查、License 检查、CI 状态；支持模板批量初始化 | 从“增删改”升级为“仓库运营” |
| 曝光优化 | 支持生成 README 首屏草稿、社交文案、GitHub Social Preview 建议；写回前 diff 预览 | 提高可发现性 |
| 通知 | 类别 × 渠道矩阵；每日/每周摘要；静默时段；Slack/飞书/Telegram | 降低打扰，提高留存 |
| 建议库 | 增加“按项目时间线”“按状态看板”“导出 CSV”；支持团队共享 | 从个人历史变成团队资产 |
| 任务中心 | 增加任务依赖、批量重试、失败原因分类、成本预估 | 提高可运维性 |
| 设置 | 增加“配置检查清单”和“推荐默认值”；区分个人设置与全局设置 | 降低自托管门槛 |
| 运维 | 增加审计日志、管理员用户管理、单用户用量、任务回放、成本预算告警 | 托管/团队部署必需 |

---

## 6. 值得新增的功能（发散）

按“先修基础，再做增长”的顺序分三层。每项都标注了目标用户、触发方式和依赖。

### H1：0–4 周，高确定性、低结构改动

| 功能 | 目标用户 | 触发方式 | 说明 | 依赖 |
| --- | --- | --- | --- | --- |
| 修复演示只读与管理员边界 | 所有托管/演示部署 | 部署即生效 | 统一写权限包装器；`demo-radar` 永不管理员；生产强制 `ADMIN_LOGINS` | 无 |
| 通知路由矩阵 | 所有用户 | 设置页保存 | 每个类别独立选择站内/邮件/推送；每周精选单独编排 | 现有 delivery queue |
| 分享链接管理 | 分享用户 | 设置/分享页 | 过期时间、撤销、访问次数、是否公开 | `radar_snapshots` 加字段 |
| 反馈撤销与解释 | 雷达用户 | 卡片/设置页 | “不感兴趣”可撤销；显示该操作对 topic/语言权重的影响 | 现有 feedback 表 |
| “采纳计划”导出 | 维护者/选型者 | 接入建议/维护周报 | 一键生成 GitHub Issue 草稿（不自动创建）、Markdown、Jira/Linear 模板 | 现有任务书 |
| 搜索历史与保存搜索 | 发现用户 | `/discover` | 保存查询、定时重跑、转成关注代理 | 现有 intent/watch |
| 每用户模型 Key | 多用户/团队 | 设置页 | 个人 BYOK，管理员配置全站默认；成本按用户归集 | llm_config 扩展 |
| MCP 写操作审计 | Agent 用户/管理员 | MCP 调用 | 记录谁通过 MCP 写了反馈/订阅/任务；支持只读 token | 新 audit 表 |
| 公开分享/收藏的隐私开关 | 分享用户 | 创建时 | 是否显示登录名、是否显示私有项目、是否允许索引 | 现有快照/集合 |

### H2：1–2 个月，结构性能力

| 功能 | 目标用户 | 触发方式 | 说明 | 依赖 |
| --- | --- | --- | --- | --- |
| 团队工作区 | 小团队/公司 | 创建团队、邀请成员 | 角色：Owner/Admin/Member/Viewer；共享收藏集、维护项目、关注意图、报告、看板；成员口味聚合 | 新 team/role 表；权限中间件 |
| GitHub App 替代 OAuth | 自托管/托管 | 安装 App | 细粒度仓库权限、自动 Webhook、安装级 token、减少 `repo` 全量授权 | GitHub App 接入层 |
| 依赖与安全中心 | 维护者 | 每日/每周 | 依赖健康、OSV、License、停更、breaking change、升级路径；和现有 OSV/依赖雷达合并成独立页 | 现有 dependencies/osv |
| 代码感知 Copilot | 维护者 | 对话/任务 | 读代码索引，回答“这个函数怎么改”“影响哪些调用方”，带文件/符号引用 | code_chunks + tree-sitter |
| 出站集成 | 团队 | 配置 Webhook | Slack/飞书/Telegram/Discord/RSS/JSON Feed；按事件类型推送 | delivery queue 扩展 |
| 定时摘要 | 所有用户 | 用户设置时区/频率 | 每日/每周摘要，支持“只发有变化的项目”；邮件/推送/IM | weekly-digest 扩展 |
| 多信号源 | 发现用户 | worker 定时 | HN、Reddit、arXiv、GitHub Discussions、包注册表趋势；作为排序信号而非内容搬运 | adapter 架构 |
| 公开证据页 | 选型者/分享 | 分享项目/验证结果 | 可公开的“验证报告”页：构建命令、日志摘要、环境、时间；带撤销 | verifications 表 |

### H3：3–6 个月，差异化/商业化

| 功能 | 目标用户 | 触发方式 | 说明 |
| --- | --- | --- | --- |
| 技术雷达环 | 团队/架构师 | 手动拖拽/评审 | Adopt / Trial / Assess / Hold 四环；按团队共享；导出图片/JSON；和项目详情、维护周报联动 |
| 组织项目组合分析 | 团队/OSS 维护组织 | 定期 | 依赖集中度、许可证风险、维护者负载、版本滞后、贡献机会；团队看板 |
| 验证徽章与公开 API | 项目作者/选型者 | 项目页/API | “RepoRadar Verified” 徽章、可嵌入 SVG、公开验证 API；形成反向链接和信任资产 |
| 集成 Playbook 市场 | 维护者 | 浏览/复用 | 把“接入建议 + 试接入补丁 + 验证日志”沉淀为可复用 playbook；支持 fork/评分 |
| 浏览器扩展 / GitHub 内联卡 | 开发者 | 浏览 GitHub 时 | 在 GitHub 仓库页显示 RepoRadar 评分、相似项目、接入建议、依赖风险 |
| AI 输出评测与 A/B | 产品/运维 | 后台 | 对报告质量做抽样评分、prompt/模型 A/B、成本/质量曲线；支撑模型选择 |
| 多语言 UI | 海外用户 | 设置 | 英文优先；报告语言与 UI 语言解耦 |
| 托管 Demo + 只读沙箱 | 新用户 | 访问即用 | 预置数据、只读演示、示例分享链接；降低“先自托管才能体验”的门槛 |

---

## 7. 建议的迭代顺序

### 第 0 步：稳定性与安全（建议立即）

1. 统一 `assertWritable`：feed、Copilot、watch、compare、issue-plan、maintain 旧 action 全部覆盖；API 同样。
2. 禁止 `demo-radar` 成为管理员；空库部署强制/提示配置 `ADMIN_LOGINS`。
3. 把 GitHub access token 从 session payload 移走，只保留服务端读取。
4. 修 release 通知偏好、Webhook/轮询重复通知、每日快照每 2 秒查询。
5. 给分享快照加过期/撤销；给公开集合加随机 slug（可选）。

### 第 1 步：收敛产品面（1–2 周）

1. 删除死代码和旧同步 AI action。
2. 合并趋势/每日/分享、接入预演/换库、贡献/相似项目入口。
3. 顶部导航从 8 个一级入口收敛为 4–5 个；工作台/建议库/设置做二级分组。
4. 统一错误提示为一次性 toast/flash，清理 URL 查询参数。

### 第 2 步：增强现有闭环（2–4 周）

1. 通知路由矩阵 + 分享生命周期 + 反馈撤销。
2. 采纳计划导出到 GitHub Issue/Markdown/Jira/Linear。
3. 搜索历史/保存搜索/转关注代理。
4. 依赖与安全中心独立页。
5. MCP 写操作审计和只读 token。

### 第 3 步：团队与平台化（1–3 个月）

1. 团队工作区与角色权限。
2. GitHub App。
3. 代码感知 Copilot。
4. 出站集成、定时摘要、多信号源。
5. 公开证据页/验证徽章。

---

## 8. 验收清单（建议逐项确认）

- [ ] 演示账号访问 feed 点击“收藏/不感兴趣/标记完成/分享”时，被明确拦截且不写库。
- [ ] 演示账号调用 `/api/copilot`、创建关注意图、触发旧 AI action 时，被明确拦截。
- [ ] 空库 + `RADAR_DEMO_MODE=1` + 未配置 `ADMIN_LOGINS` 时，`demo-radar` 不是管理员。
- [ ] `/api/auth/session` 响应中不包含 GitHub access token。
- [ ] 关闭 Release 通知后，release 订阅不会再产生站内/邮件/推送通知（或产品明确说明两者独立）。
- [ ] 同时开启 Webhook 和轮询时，同一事件只通知一次。
- [ ] 隐藏 10 个项目后，feed 第一页仍能补足到目标条数。
- [ ] `/ops` 在配置 `METRICS_TOKEN` 后仍能正确引导管理员抓取指标。
- [ ] 分享快照可以撤销/过期，撤销后 `/radar/[token]` 返回 404。
- [ ] 顶部导航、工作台 tab、建议库 tab 的层级在 30 秒内可被新用户理解。

---

## 9. 需要产品决策的问题

这些问题会直接影响“该删什么、该加什么”，建议在验收时一起确认：

1. **RepoRadar 的主战场是“个人自托管”还是“团队/托管服务”？**  
   如果是个人，团队工作区可以后置；如果是团队，角色/权限/审计必须提前做。

2. **P3 内容创作者是否仍是核心用户？**  
   如果不是，技术周报、分享卡、每日榜单应降级为“内容工具”，不再占用一级导航。

3. **演示账号是否允许任何写操作？**  
   建议严格只读；如果希望演示“生成效果”，应使用预生成结果，而不是实时调用模型。

4. **公开分享的默认隐私策略是什么？**  
   默认隐藏登录名？默认 30 天过期？是否允许搜索引擎索引？

5. **是否接受“只做证据，不自动改代码”的边界？**  
   当前产品明确不自动提交/开 PR。如果未来增加“自动开 PR”，需要重新设计权限、审计和回滚。

6. **模型成本由谁承担？**  
   全站 Key、每用户 BYOK、还是托管套餐？这决定配额、模型路由和成本页的设计。

7. **是否要把 MCP 作为一等公民？**  
   如果目标是“Agent 工作流里的开源雷达”，MCP 的写权限、审计、资源/提示词、任务轮询应该优先做深。

---

## 附录 A：页面路由清单

业务页：`/feed`、`/discover`、`/trends`、`/daily`、`/share/trending`、`/r/[owner]/[name]`、`/radar/[token]`、`/collections/[id]`、`/workbench/maintain`、`/workbench/maintain/similar`、`/workbench/integrations`、`/workbench/swap`、`/workbench/contribute`、`/workbench/watch`、`/workbench/copilot`、`/workbench/issue`、`/issue-plan`、`/compare`、`/patch/[id]`、`/repos`、`/repos/[owner]/[name]/optimize`、`/tasks`、`/inbox`、`/library`、`/settings`、`/setup`、`/ops`、`/login`、`/unsubscribe`、`/privacy`、`/terms`。

兼容/重定向页：`/`（已登录跳 feed）、`/workbench`、`/collections`、`/history`、`/maintain`、`/integrations`、`/watch`、`/issue`、`/copilot`。

## 附录 B：任务类型清单

`integration`、`maintainer`、`issue`、`discoverability`、`comparison`、`issue-plan`、`watch`、`activity`、`patch`、`upgrade`、`discover`、`enrich`、`similar`、`integration-trial`、`swap-trial`、`repo-profile`。

## 附录 C：本次审计未覆盖的内容

- 未做真实用户行为数据分析（使用率、留存、转化），因此“删除/降级”建议基于代码结构、入口重叠和产品定位，不基于真实使用量。
- 未做完整的安全渗透测试；P0/P1 中的开放重定向、token 暴露等建议在修复前再做一次针对性验证。
- 未逐条验证所有 AI 输出质量；模型质量评估仍应使用现有 `pnpm eval:ai` 和真实样本。
- 未验证多实例部署下的限流、advisory lock、任务并发行为。

---

## 10. 修复进度

### 2026-11-05：第 0 批（安全边界与后台稳定性）

已完成：

- [x] P0-2：`isAdminUser` 明确排除 `demo-radar`，演示账号不会再因“最早用户”规则成为管理员。
- [x] P0-3：OAuth access token 从 session callback 移除，服务端统一从加密用户凭据表读取；`/api/auth/session` 不再携带 token。
- [x] P0-1：feed 反馈/不感兴趣/标记完成/雷达模式/分享、Copilot action、关注代理意图、对比/Issue 方案/维护旧 action、仓库管理 action、任务取消/重试均补上 `assertWritable`；`/api/copilot` 对演示账号返回 403。
- [x] P1-1：Release 订阅通知读取 `githubRelease` 偏好，关闭后不再产生 release 站内通知。
- [x] P1-2：Webhook 与轮询统一使用 `activityDedupeKey`，避免同一事件因 delivery id / event id 不同而重复通知。
- [x] P1-5：每日快照检查增加 10 分钟间隔，不再每个 2 秒循环查两次数据库。
- [x] P1-6：趋势简报检查增加 30 分钟间隔，不再每个循环查最新报告。
- [x] P1-13：`/ops` 的 Prometheus 入口改为页内锚点，不再直接跳转会 401 的 `/api/metrics`。
- [x] 删除未使用的 `recoverJobsAction`。

验证：

- `pnpm typecheck` 通过；
- `pnpm test` 通过（346 个测试）；
- `pnpm lint` 通过；
- `pnpm build` 通过；
- 新增 `activityDedupeKey` 的跨来源一致性测试。

下一批建议：

1. 删除旧同步 AI action 和相关文件，收敛到任务队列。
2. 处理 `adminLogins` 未配置时的管理员继承规则（删除唯一管理员保护）。
3. 给分享快照增加过期/撤销。
4. 通知类别 × 渠道矩阵。

### 2026-11-05：第 1 批（收敛旧路径与分享生命周期）

已完成：

- [x] P1-10：删除未使用的旧同步 AI action 和文件：
  - `app/(app)/compare/actions.ts`
  - `app/(app)/issue-plan/actions.ts`
  - `app/(app)/workbench/maintain/actions.ts`
  - `app/actions.ts` 中的 `generateIssueAction`、`generateIntegrationAction`
  - `workbench/watch/actions.ts` 中的 `runWatchIntentAction`
- [x] P1-8：`deleteAccountAction` 在未配置 `ADMIN_LOGINS` 时，如果当前用户是实际管理员且还有其他用户，会阻止删除，避免管理员身份静默转移。
- [x] P1-7：分享快照增加 `expires_at` / `revoked_at`（迁移 `0017_radar_snapshot_lifecycle.sql`），默认 90 天过期；设置页可以查看和撤销最近分享链接；过期或撤销后 `/radar/[token]` 返回 404。
- [x] 新增 `listRadarSnapshots`、`revokeRadarSnapshot`，设置页增加“分享链接”管理区。

验证：

- `pnpm typecheck` 通过；
- `pnpm test` 通过（346 个测试）；
- `pnpm lint` 通过；
- `pnpm build` 通过；
- `pnpm test:db` 因当前环境没有可用测试数据库而跳过（14 个集成测试文件 skipped），部署前需要在一个有 Postgres 的环境重跑迁移和集成测试。

下一批建议：

1. 通知类别 × 渠道矩阵。
2. Feed 快照在反馈/偏好变更后失效或自动补页。
3. 顶部导航、工作台、建议库的入口收敛。
4. 曝光优化/维护/接入页面的错误提示改为一次性 toast。

### 2026-11-05：第 2 批（通知路由与 Feed 快照）

已完成：

- [x] P1-14：通知增加“类别 × 渠道”矩阵。
  - 类别：Star / Fork / Issue / PR / Release 动态 / 版本订阅 / AI 工作 / 系统。
  - 邮件和浏览器推送分别配置；站内收件箱始终保留。
  - 旧用户没有 `emailKinds` / `pushKinds` 时保持原行为（总开关打开即全量投递），避免升级后突然收不到通知。
  - 新增 `notificationCategory`、`notificationChannelEnabled` 和对应单元测试。
- [x] P1-3：Feed 快照与反馈同步。
  - 新增 `invalidateFeedSnapshot`；反馈、偏好、订阅、同步画像、标记完成/不感兴趣后删除快照，下一次请求实时重排。
  - 页面读取快照时多取 3 倍候选再过滤，避免隐藏项目后第一页缩水。

验证：

- `pnpm typecheck` 通过；
- `pnpm test` 通过（349 个测试）；
- `pnpm lint` 通过；
- `pnpm build` 通过。

补充：顶部导航移除了重复的“榜单”入口，每日榜仍可从趋势页进入。

下一批建议：

1. 工作台/建议库 tab 分组。
2. 错误提示改为一次性 toast，清理 URL `?error=`。
3. 公开收藏集随机 slug（可选）。
4. 依赖与安全中心独立页。

### 2026-11-05：第 3 批（工作台入口与公开收藏集）

已完成：

- [x] 工作台 tab 从 7 个减到 6 个：移除“贡献”tab，把“贡献机会”入口放到维护周报页头部；`/workbench/contribute` 页面本身保留。
- [x] 公开收藏集使用随机 `public_slug`（迁移 `0018_collection_public_slug.sql`）：
  - 新建收藏集自动生成 12 位 slug；
  - 已有收藏集回填 slug；
  - `/collections/[id]` 同时支持自增 ID 和公开 slug；
  - 公开收藏集详情页显示公开链接；
  - 私有收藏集不会通过 slug 访问。
- [x] 本地数据库已执行迁移 0017、0018。
- [x] Web 服务已重启并通过 `/api/health` 健康检查。

验证：

- `pnpm lint` 通过；
- `pnpm typecheck` 通过；
- `pnpm test` 通过（349 个测试）；
- `pnpm build` 通过；
- `pnpm db:migrate` 成功；
- `GET /api/health` 返回 `{"ok":true,"database":"ok"}`。

下一批建议：

1. 错误提示改为一次性 toast，逐步清理 URL `?error=`。
2. 依赖与安全中心独立页。
3. 团队工作区前的角色/权限基础。

### 2026-11-05：第 4 批（建议库分组与一次性提示）

已完成：

- [x] 建议库 tab 增加分组：建议（接入/关注/维护/对比/曝光）+ 记录（历史报告），减少“6 个 tab 平铺”的认知负担。
- [x] 新增 `QueryToast` 客户端组件：
  - 从 URL 参数读取错误码并映射成可读消息；
  - 以固定 toast 展示，5 秒后自动消失；
  - 展示后清理 URL 中的 `error` 参数，避免刷新后重复提示。
- [x] 维护周报、接入建议、换库、关注代理四个工作台页面先接入一次性 toast。
- [x] 旧 `?error=` 的页面内联提示移除，保留非 URL 状态的权限/引导提示。

验证：

- `pnpm lint` 通过；
- `pnpm typecheck` 通过；
- `pnpm test` 通过（349 个测试）；
- `pnpm build` 通过；
- Web 服务已重启并通过 `/api/health` 健康检查。

下一批建议：

1. 依赖与安全中心独立页。
2. 设置页错误/成功提示迁移到 toast。
3. 公开雷达/收藏集的分享入口与复制体验。
4. 团队角色与权限基础。

### 2026-11-05：第 5 批（依赖与安全中心）

已完成：

- [x] 新增 `/workbench/dependencies` 页面：
  - 汇总最近一次维护周报里的依赖项、当前版本/最新版本、风险等级和升级步骤；
  - 展示安全公告数量和具体公告；
  - 展示已接入库的版本/安全回访；
  - 无报告时引导回维护周报生成；
  - 维护周报页头部增加“依赖与安全”入口。
- [x] 新页面复用现有 `maintainer_reports`、`integration_impacts`，不新增外部服务或数据库表。

验证：

- `pnpm lint` 通过；
- `pnpm typecheck` 通过；
- `pnpm test` 通过（349 个测试）；
- `pnpm build` 通过；
- Web 服务已重启并通过 `/api/health` 健康检查。

下一批建议：

1. 设置页错误/成功提示迁移到 toast。
2. 公开雷达/收藏集的分享入口与复制体验。
3. 团队角色与权限基础。
4. Feed 快照版本号与更细的失效策略。

### 2026-11-05：第 6 批（设置页 toast 与分享复制）

已完成：

- [x] 设置页大量 `?oauth=` / `?llm=` / `?notify=` / `?mail=` / `?site=` / `?pool=` 等内联提示迁移到 `QueryToastGroup`。
  - 成功和失败用不同色调；
  - 展示后清理对应 URL 参数；
  - 保留“模型配置无法解密”这类需要常驻说明的非 URL 状态提示。
- [x] 抽出通用 `components/ui/CopyButton.tsx`，替换 setup 页原来的局部实现。
- [x] 分享雷达页 `/radar/[token]` 增加“复制分享链接”。
- [x] 公开收藏集详情页增加“复制公开链接”。
- [x] 设置页“分享链接”列表增加复制按钮，仅对未撤销/未过期链接显示。

验证：

- `pnpm lint` 通过；
- `pnpm typecheck` 通过；
- `pnpm test` 通过（349 个测试）；
- `pnpm build` 通过；
- Web 服务已重启并通过 `/api/health` 健康检查。

下一批建议：

1. 团队角色与权限基础。
2. Feed 快照版本号与更细的失效策略。
3. 公开收藏集/雷达的访问统计。
4. 设置页配置检查清单。

### 2026-11-06：第 7 批（团队角色与权限基础）

已完成：

- [x] 新增迁移 `0019_teams.sql`：
  - `teams`：团队名称、所有者、创建时间；
  - `team_members`：团队、用户、角色（owner / admin / member / viewer）。
- [x] 新增 `packages/core/src/teams.ts`：
  - 创建团队、列出用户团队、查询团队成员；
  - 按 GitHub 登录名添加成员；
  - 更新角色、移除成员、删除团队；
  - 角色规则：owner 不可被移除/降级；admin 可管理成员；member 可读写；viewer 只读。
- [x] 新增 `/teams` 页面：
  - 创建团队；
  - 团队切换；
  - 成员列表；
  - 邀请成员；
  - 修改角色；
  - 移除成员；
  - 所有者删除团队。
- [x] 设置页增加“团队工作区”入口。
- [x] 新增 `packages/core/tests/teams.test.ts`，覆盖角色识别、管理权限和可分配角色。
- [x] 本地数据库已执行迁移 0019。

验证：

- `pnpm lint` 通过；
- `pnpm typecheck` 通过；
- `pnpm test` 通过（352 个测试）；
- `pnpm build` 通过；
- `pnpm db:migrate` 成功；
- Web 服务已重启并通过 `/api/health` 健康检查。

下一批建议：

1. 把收藏集、维护项目、关注意图接入团队共享范围。
2. Feed 快照版本号与更细的失效策略。
3. 公开收藏集/雷达的访问统计。
4. 设置页配置检查清单。

### 2026-11-06：第 8 批（团队共享收藏集）

已完成：

- [x] 新增迁移 `0020_team_collections.sql`：`collections.team_id`，团队删除时级联清理团队收藏集。
- [x] 收藏集权限模型扩展为：
  - 个人所有者：完整权限；
  - 团队成员：可写入；
  - 团队只读：只能查看；
  - 公开收藏集：匿名可读。
- [x] `listCollections` 现在同时返回个人收藏集和用户所在团队的收藏集，并带上 `access` / `teamName` / `teamRole`。
- [x] 新增 `findCollectionAccess`，页面和 action 统一按成员身份判断读写。
- [x] 新建收藏集可以选择归属团队；项目详情页的“加入收藏集”只显示用户可写的个人/团队收藏集。
- [x] 收藏集详情页显示团队、角色和只读状态；团队管理员/所有者可以删除团队收藏集。
- [x] 本地数据库已执行迁移 0020。

验证：

- `pnpm lint` 通过；
- `pnpm typecheck` 通过；
- `pnpm test` 通过（352 个测试）；
- `pnpm build` 通过；
- `pnpm db:migrate` 成功；
- Web 服务已重启并通过 `/api/health` 健康检查。

下一批建议：

1. 维护项目和关注意图接入团队共享。
2. Feed 快照版本号与更细的失效策略。
3. 公开收藏集/雷达的访问统计。
4. 设置页配置检查清单。

### 2026-11-06：第 9 批（团队共享关注意图）

已完成：

- [x] 新增迁移 `0021_team_watch_intents.sql`：`watch_intents.team_id`，团队删除时级联清理团队意图。
- [x] 关注代理支持团队归属：
  - 个人意图：创建者完整权限；
  - 团队意图：owner/admin/member 可运行和删除；
  - 团队 viewer：只读，不能运行或删除；
  - 团队意图的匹配结果对团队成员共享。
- [x] `listWatchIntents` / `findWatchIntent` 同时返回个人和团队意图，并带上 `teamName` / `teamRole` / `access`。
- [x] 关注页新增“归属”选择，支持创建团队意图；只读意图隐藏运行/删除操作。
- [x] `enqueueWatchRunAction` 对只读意图返回 forbidden。
- [x] 本地数据库已执行迁移 0021。

验证：

- `pnpm lint` 通过；
- `pnpm typecheck` 通过；
- `pnpm test` 通过（352 个测试）；
- `pnpm build` 通过；
- `pnpm db:migrate` 成功；
- Web 服务已重启并通过 `/api/health` 健康检查。

下一批建议：

1. 维护项目接入团队共享视图。
2. Feed 快照版本号与更细的失效策略。
3. 公开收藏集/雷达的访问统计。
4. 设置页配置检查清单。

### 2026-11-06：第 10 批（分享与公开收藏集访问统计）

已完成：

- [x] 新增迁移 `0022_share_view_stats.sql`：`radar_snapshots`、`collections` 增加 `view_count` / `last_viewed_at`。
- [x] 分享雷达公开页每次渲染记录一次浏览，并在页头显示浏览数。
- [x] 公开收藏集被非编辑者访问时记录浏览，并在详情页显示浏览数。
- [x] 设置页“分享链接”列表显示每个链接的浏览数。
- [x] 新增 `recordRadarSnapshotView`、`recordPublicCollectionView`。
- [x] 本地数据库已执行迁移 0022。

验证：

- `pnpm lint` 通过；
- `pnpm typecheck` 通过；
- `pnpm test` 通过（352 个测试）；
- `pnpm build` 通过；
- `pnpm db:migrate` 成功；
- Web 服务已重启并通过 `/api/health` 健康检查。

下一批建议：

1. 维护项目接入团队共享视图。
2. Feed 快照版本号与更细的失效策略。
3. 设置页配置检查清单。
4. 公开证据页 / 验证徽章。

### 2026-11-06：第 11 批（团队共享维护项目视图）

已完成：

- [x] 新增迁移 `0023_team_project_shares.sql`：显式共享的项目引用，不改变项目原有归属。
- [x] 新增 `packages/core/src/team-projects.ts`：
  - `listTeamProjectShares`：列出团队共享项目；
  - 从团队成员最近的维护周报里提取该项目的健康分、依赖风险、待办数量；
  - `shareTeamProject` / `unshareTeamProject`。
- [x] `/teams` 团队详情新增“共享维护项目”：
  - 团队成员可共享 `owner/repo`；
  - 显示最近一次维护周报摘要（健康分、依赖风险、待办、报告人）；
  - owner/admin/member 可移除共享，viewer 只读。
- [x] 本地数据库已执行迁移 0023。

验证：

- `pnpm lint` 通过；
- `pnpm typecheck` 通过；
- `pnpm test` 通过（352 个测试）；
- `pnpm build` 通过；
- `pnpm db:migrate` 成功；
- Web 服务已重启并通过 `/api/health` 健康检查。

下一批建议：

1. Feed 快照版本号与更细的失效策略。
2. 设置页配置检查清单。
3. 公开证据页 / 验证徽章。
4. 团队维护项目的生成与汇总视图。

### 2026-11-06：第 12 批（Feed 快照版本与失效）

已完成：

- [x] 新增迁移 `0024_feed_snapshot_version.sql`：`feed_snapshots.version`。
- [x] 快照版本由评分版本和快照结构版本组成：
  - `FEED_SNAPSHOT_SCHEMA_VERSION = 2`
  - `FEED_SNAPSHOT_VERSION = score@1:snapshot-v2`
- [x] `loadFeedSnapshot` 只接受当前版本；旧版本快照自动忽略并触发重建。
- [x] `listUsersNeedingFeedSnapshot` 只把“当前版本快照不存在”的用户视为需要刷新。
- [x] 新增集成测试覆盖旧版本快照失效。
- [x] 本地数据库已执行迁移 0024。

验证：

- `pnpm lint` 通过；
- `pnpm typecheck` 通过；
- `pnpm test` 通过（352 个测试；数据库集成测试在无测试库时跳过）；
- `pnpm build` 通过；
- `pnpm db:migrate` 成功；
- Web 服务已重启并通过 `/api/health` 健康检查。

下一批建议：

1. 设置页配置检查清单。
2. 公开证据页 / 验证徽章。
3. 团队维护项目的生成与汇总视图。
4. 通知/任务的批量操作。

### 2026-11-06：第 13 批（设置页配置检查清单）

已完成：

- [x] 设置页顶部新增“配置检查”清单，按正常 / 建议 / 缺失三档展示。
- [x] 个人检查项：
  - GitHub 授权与 repo 权限
  - 口味画像
  - 通知邮箱
  - 浏览器推送设备
- [x] 管理员额外检查项：
  - AI 模型
  - 候选池
  - 邮件通道
  - 站点地址
  - GitHub Webhook
- [x] 每个检查项可以点击跳到对应设置分区。
- [x] 设置导航增加“配置检查”入口。
- [x] 不新增数据库表，复用设置页已有数据。

验证：

- `pnpm lint` 通过；
- `pnpm typecheck` 通过；
- `pnpm test` 通过（352 个测试）；
- `pnpm build` 通过；
- Web 服务已重启并通过 `/api/health` 健康检查。

下一批建议：

1. 公开证据页 / 验证徽章。
2. 团队维护项目的生成与汇总视图。
3. 通知/任务的批量操作。
4. 配置检查项接入 `runDoctor` 的深度检查。

### 2026-11-06：第 14 批（公开验证证据与徽章）

已完成：

- [x] 新增公开页 `/evidence/[owner]/[name]`：
  - 展示最近一次沙箱验证状态、技术栈、耗时、exit code、commit；
  - 展示执行命令；
  - 展示最近 8 次验证历史；
  - 不公开构建日志，避免泄露构建环境、路径或凭据。
- [x] 新增公开徽章接口 `/api/badge/[owner]/[name]`：
  - verified / build failed / error / skipped / not verified / unknown；
  - 返回 SVG，可直接放进 README。
- [x] 证据页提供 Markdown 徽章复制。
- [x] 项目详情页“验证状态”增加“公开证据页与徽章”入口。
- [x] 无验证记录时给出 `pnpm radar verify` 引导。

验证：

- `pnpm lint` 通过；
- `pnpm typecheck` 通过；
- `pnpm test` 通过（352 个测试）；
- `pnpm build` 通过；
- Web 服务已重启并通过 `/api/health` 健康检查。

下一批建议：

1. 团队维护项目的生成与汇总视图。
2. 通知/任务的批量操作。
3. 配置检查项接入 `runDoctor` 的深度检查。
4. 公开 API / RSS / JSON Feed。

### 2026-11-06：第 15 批（团队维护汇总视图）

已完成：

- [x] 新增 `/teams/[id]/maintain` 团队维护汇总页。
- [x] 汇总团队共享项目的最近一次维护周报：
  - 健康分与项目摘要；
  - 依赖风险（版本、风险等级、安全公告）；
  - Issue / PR 待办（优先级、编号、标题）；
  - 本周建议动作；
  - 报告人和生成时间。
- [x] 顶部统计共享项目、有报告项目、依赖风险、Issue/PR 待办总数。
- [x] 每个项目提供验证证据页和 GitHub 入口。
- [x] 团队页增加“维护汇总”入口。
- [x] 明确说明：团队报告由成员各自生成后汇总；当前不会用他人的 token 代替生成。

验证：

- `pnpm lint` 通过；
- `pnpm typecheck` 通过；
- `pnpm test` 通过（352 个测试）；
- `pnpm build` 通过；
- Web 服务已重启并通过 `/api/health` 健康检查。

下一批建议：

1. 通知/任务的批量操作。
2. 配置检查项接入 `runDoctor` 的深度检查。
3. 公开 API / RSS / JSON Feed。
4. 团队维护报告的定时汇总邮件。

### 2026-11-06：第 16 批（通知与任务批量操作）

已完成：

- [x] 收件箱支持勾选多条通知，批量标记已读；保留“全部标记已读”。
- [x] 任务中心支持勾选多条任务：
  - 批量取消；
  - 批量重试；
  - 操作前校验任务归属，配额不足时跳回任务中心提示。
- [x] 新增 `markSelectedNotificationsReadAction`、`bulkCancelJobsAction`、`bulkRetryJobsAction`。
- [x] 新增 `BulkJobActions` 客户端组件，按当前勾选项提交。
- [x] 批量操作不新增数据库表。

验证：

- `pnpm lint` 通过；
- `pnpm typecheck` 通过；
- `pnpm test` 通过（352 个测试）；
- `pnpm build` 通过；
- Web 服务已重启并通过 `/api/health` 健康检查。

下一批建议：

1. 配置检查项接入 `runDoctor` 的深度检查。
2. 公开 API / RSS / JSON Feed。
3. 团队维护报告的定时汇总邮件。
4. 通知按类别批量操作。

### 2026-11-06：第 17 批（配置检查接入 runDoctor）

已完成：

- [x] 设置页管理员新增“深度检查”区域。
- [x] 按需运行 `runDoctor`，不在每次打开设置页时执行。
- [x] 展示数据库、迁移、pgvector、候选池、模型、Embedding、GitHub 授权、邮件、站点地址、任务队列检查结果。
- [x] 不发送邮件、不调用模型，只读检查。

验证：

- `pnpm lint` 通过；
- `pnpm typecheck` 通过；
- `pnpm test` 通过（352 个测试）。

### 2026-11-06：第 18 批（公开 RSS / JSON Feed）

已完成：

- [x] 新增公开 RSS：`/rss.xml`，输出每日飙升 Top10。
- [x] 新增公开 JSON：`/api/public/daily`，输出日期口径、榜单条目、star 增量、语言、摘要和项目链接。
- [x] 两个接口都不需要登录，带 10 分钟缓存。
- [x] JSON 接口允许跨域读取。
- [x] 趋势页和每日榜页增加 RSS / JSON 入口。

验证：

- `pnpm lint` 通过；
- `pnpm typecheck` 通过；
- `pnpm test` 通过（352 个测试）。

### 2026-11-06：第 19 批（团队维护摘要邮件）

已完成：

- [x] 新增迁移 `0025_team_digest.sql`：`teams.digest_enabled`。
- [x] 团队所有者/管理员可以开启或关闭团队周报邮件。
- [x] 新增 `buildTeamDigest`：汇总团队共享项目的健康分、依赖风险、待办和报告人。
- [x] worker 每 30 分钟检查，开启周报的团队按 ISO 周去重入队邮件。
- [x] 只发送给开启 `emailNotifications` 且能解析通知邮箱的团队成员。
- [x] 同一团队同一周只投递一次。
- [x] 本地数据库已执行迁移 0025。

验证：

- `pnpm lint` 通过；
- `pnpm typecheck` 通过；
- `pnpm test` 通过（352 个测试）；
- `pnpm db:migrate` 成功。

### 2026-11-06：第 20 批（通知分类批量已读）

已完成：

- [x] 收件箱分类筛选下新增“本分类已读”。
- [x] 支持 GitHub / AI 工作 / 版本 / 系统四个分类批量标记已读。
- [x] 新增 `markNotificationsReadMatching`，复用通知筛选条件。
- [x] 新增 `markInboxCategoryReadAction`。

验证：

- `pnpm lint` 通过；
- `pnpm typecheck` 通过；
- `pnpm test` 通过（352 个测试）。

---

## 11. 执行完成情况（第 0–20 批）

已落地的优化与功能：

- 安全边界：演示账号只读、demo 不可成为管理员、OAuth token 移出 session。
- 通知：Release 偏好、Webhook/轮询去重、类别 × 渠道矩阵、批量已读、分类已读。
- Feed：快照失效、补页、版本号；worker 定时任务降频。
- 任务：批量取消、批量重试。
- 分享：过期/撤销、浏览统计、复制链接。
- 团队：角色权限、共享收藏集、共享关注意图、共享维护项目、维护汇总、周报邮件。
- 设置：一次性 toast、配置检查、runDoctor 深度检查、分享链接管理。
- 发现与内容：依赖与安全中心、公开验证证据页、验证徽章、公开 RSS / JSON Feed。
- 清理：旧同步 AI action、兼容死代码、指标入口、公开收藏集 slug。

仍保留为后续路线图（需要产品决策或更大基础设施）的项：

- GitHub App 替代 OAuth。
- 代码感知 Copilot（读代码索引回答）。
- Slack / 飞书 / Telegram 等出站集成。
- HN / Reddit / arXiv 等多信号源。
- 技术雷达四环、组织项目组合分析。
- 集成 Playbook 市场、浏览器扩展。
- 多语言 UI、托管 Demo。
- 每用户模型 Key、MCP 写操作审计。

这些没有在本次连续执行中强行落地，因为它们涉及外部服务、权限模型扩展或明显的产品方向决策，不应在未确认的情况下一次性堆入。
