# 夜间交付说明（2026-11-02）

这份文档给早上的验收用：每个功能在哪、怎么验、需要什么环境、还有什么限制。

## 一句话总结

`docs/ROADMAP-AI.md` 里的 8 个 AI 功能都已经有可运行的代码路径，并配套了迁移、测试和页面入口。
所有改动分 8 次提交，工作区干净；`lint / typecheck / test / test:db / build / test:e2e` 全绿。

## 验收前先做

```bash
pnpm install --frozen-lockfile
pnpm db:migrate          # 0008 patch_kind / 0009 integration_impacts / 0010 code_chunks
pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm test:db && pnpm build
pnpm test:e2e
```

开发库已经应用过 0008–0010。真实跑 AI / 沙箱 / GitHub 相关功能还需要：

- `/settings` 里配置模型 Key（试接入、换库、能力矩阵、代码索引的 embedding 都依赖它）；
- 主机可用的 Docker（接入预演、换库沙盘的沙箱验证）；
- GitHub OAuth 或 `GITHUB_TOKEN`（读取 Issue、仓库文件、release）。

## 新增的发现类功能（2026-11-02）

- `/discover`：登录后输入一句话需求，例如「能解析 PDF 表格、TypeScript、还在维护的库」；结果是带解释的候选，点「看详情」进仓库页。
- 仓库页「AI 功能画像」：首次点「生成功能画像」需要 GitHub 授权和模型配置；生成后按 README hash 缓存，README 变了可以重新生成。
- `/trends`：先展示 7 天增速/topic 动量/新项目；AI 简报由 worker 每 12 小时生成（没有模型时显示数据版）。
- 榜单默认剔除官方框架和老牌巨无霸（10 万 star + 建库 2 年），可点「显示官方框架」切换；每日榜单落库，支持 `/daily?date=YYYY-MM-DD` 回看。
- `/daily`：每日榜单（当前 star − 上一次快照 Top10），可复制文字/导出图片；worker 每天记录快照，手动补跑用 `pnpm radar snapshot`。快照不足一天时会标注为多日增量。
- `/share/trending`：把 7 天 star 增量 Top 10 做成分享海报，默认 11 张图（封面 + Top 10 详情页），可逐张或全部导出；详情内容优先取 AI 功能画像。
- 原分享卡说明：把 7 天 star 增量 Top 10 做成分享海报；可「复制文字」或「导出图片」（2x PNG），文案由 AI 生成并按天缓存。海报还带「新库速度榜」（建库以来日均 star），没有 7 天快照的新库也能出现。
- 分享卡/每日榜里如果某仓库没有功能画像，「它能做什么」会显示提示而不是主题标签；页面上的「补全 3 个画像」可以现场生成。
- 没有 GitHub topic 的仓库可以在仓库页点「AI 推断主题」，或批量跑 `pnpm radar infer-topics`；推断结果不会覆盖 GitHub 原始 topic。
- 趋势只覆盖**已收录且已富化**的仓库；发现漏了热门项目时，可以先手动收录：
  `pnpm radar ingest --repo=owner/name && pnpm radar enrich --limit=1`，或在部署环境跑一次正常采集。
- 三个功能都依赖模型配置（设置页）；意图搜索还依赖仓库已有的 embedding，没有 embedding 时会退化为关键词召回。

## 任务质量与成本看板

`/ops`（管理员）新增「AI 任务质量（近 30 天）」：按任务类型展示任务数、成功率、均值/P95 耗时、
输入/输出 tokens 和失败原因 Top。数据来自 `ai_jobs`（时间）和 `llm_usage`（token），不需要新迁移。
同一个页面还有「AI 成本（近 30 天）」：按模型配置每 100 万 token 的美元单价（输入/输出分开），
自动估算调用成本；未配置单价的模型只显示 token 不显示金额。价格保存在 `app_settings`，随时可改。
配合 `pnpm eval:ai` 可以同时看「固定场景质量」和「线上真实成功率」。

## AI 质量评测

配置好模型后可以跑固定场景回归（会真实调用模型，约 1 分钟）：

```bash
pnpm eval:ai                                        # 对比 + 试接入 + 机械换库
pnpm eval:ai -- --scenario=swap                     # 只跑不花钱的机械换库
pnpm eval:ai -- --models=deepseek-flash,deepseek-chat --repeat=3  # 多模型各跑 3 次
pnpm eval:ai -- --models=a,b --prices="a:0.14:0.28,b:0.27:1.10"  # 临时价格，不写库
```

检查项：对比报告的结构/能力矩阵/推荐合法性、试接入补丁能否 `git apply`、机械换库的依赖和 import
是否都替换。报告写到 `eval-results/ai-<时间>.md|json`；通过数低于 70% 时退出码非 0。
2026-11-02 单模型基线是 3/3。

多模型运行会按模型汇总通过数、耗时、输入/输出 tokens 和估算成本（价格来自 `/ops` 或 `--prices`），
推荐顺序是「通过数 → 成本 → 耗时」。

2026-11-02 在加入「补丁不可应用时重试」后，用 `--repeat=3` 对比：
两个模型都是 **6/6**；chat 35.1s、输出 6.3k tokens，flash 163.3s、输出 27.7k tokens。
结论：**默认已切换为 `deepseek-chat`**，`deepseek-flash` 作为备选；切换后默认配置复跑 6/6（36.1s）。
真实仓库 `vercel/arg` 的完整沙箱验证也通过了：1.6s 生成补丁，Docker 里 `npm install` + `npm test`，
**applies: true / buildStatus: verified / 39 tests passed**。完整数据见 [MODEL-SELECTION.md](MODEL-SELECTION.md)。

## 演示数据

没有模型 Key 也可以先把界面填满：

```bash
pnpm radar demo-seed
```

会写入 10 个真实仓库（带中文摘要/评分/7 天前 star 快照）、用户 `demo-radar` 的画像、一条收藏、
一条订阅和两个「维护中」项目。命令幂等，可重复执行；数据仅用于演示，**不代表真实归属**。
写入后 `pnpm radar list` 和 Web 首页都会立刻有内容；MCP 可以用 `login: demo-radar` 体验个性化工具。
设置 `RADAR_DEMO_MODE=1` 后，登录页会出现「以演示账号进入」，方便没有 GitHub OAuth 的演示环境。

## 逐项验收

### 1 + 2. 接入预演 / 适配层生成

- 入口：`/workbench/integrations`，先「生成接入建议」，再在任意建议上点「试接入（沙箱预演）」。
- 可填「接入文件」（如 `src/lib/foo.ts`）：填了会让模型在补丁里顺带写最小接线，即适配层。
- 验收点：任务中心出现「接入预演」；完成后通知/结果链到 `/patch/<id>`，页面标题是「接入预演」，
  能看到 diff、`git apply` 结果、构建日志；状态为 `validated` 或 `failed`。
- 不需要改远端仓库，也不会自动提交。

### 3. 接入后回访

- 在接入建议上点「标记已接入」；worker 每 6 小时检查该库的 release，只回访「接入之后发布」的版本。
- 验收点：`/workbench/integrations` 出现「接入回访」面板；收件箱 / 通知里有对应消息。
- 想立刻验证可以手动触发：

```bash
pnpm exec tsx -e "import('@repo-radar/core').then(async (core) => { const pool = core.createPool(process.env.DATABASE_URL); console.log(await core.checkIntegrationImpacts(pool, {})); await pool.end() })"
```

### 4. 能力差异矩阵

- 入口：`/compare`，重新生成一份选型对比。
- 验收点：候选卡片下方出现「能力差异」表格（项目 + 各候选一行一个维度），导出的任务书里也有表格。
- 旧报告没有该字段，页面会自动跳过，不影响展示。

### 5. 代码级证据

- 触发：接入预演时自动执行，无需单独操作。
- 流程：拉取候选仓库文件树 → 优先 `main/module/exports/bin` 入口，按函数/类切块（最多 8 个文件，每个最多 8 块）
  → 有 embedding 时走向量检索，没有时退化为关键词匹配 → 把 top 3 片段放进试接入提示词。
- 验收点：任务日志里有「索引候选仓库的入口代码…」；对同一个候选第二次预演会复用索引。
- 已知限制：只索引少量入口文件，不做全仓库索引；超大文件会截断。

### 6. 换库沙盘

- 入口：`/workbench/swap`（工作台「换库」标签）。
- 填「项目 + 从哪个包 + 换成哪个包（+ 可选目标文件）」，生成迁移补丁并在沙箱验证。
- 验收点：任务中心出现「换库预演」；`/patch/<id>` 标题为「换库预演」，能看 diff 和构建结果。
- 已知限制：迁移是模型生成的补丁，不是 AST codemod；复杂 API 迁移需要人工确认，summary 会列出待确认点。

### 7. 贡献雷达

- 入口：`/workbench/contribute`（工作台「贡献」标签）。
- 用标记为「维护中」的项目找相似仓库，再筛 `good first issue` / `help wanted` 之类的开放 Issue。
- 验收点：列表里出现「仓库 · 相似度 · 与哪个项目相关」，每条 Issue 有 GitHub 链接和「生成修复方案」按钮，
  点击进入现有 `/issue-plan` 流程。
- 已知限制：需要 GitHub 授权读 Issue；只取最近 20 条开放 Issue，按相似度排序取前 8 个仓库。

### 8. MCP 决策工具

- 新增工具：`pick_library`、`integration_preflight`、`similar_diff`（原有 10 个工具不变）。
- 冒烟：`node --import tsx apps/worker/scripts/check-mcp.mjs`，输出里应包含这三个名字。
- 验收点：在 Claude Code / Cursor 里 `pick_library({task, language})` 能返回候选；
  `integration_preflight({project, candidate, login})` 能返回最近一次试接入的补丁摘要；
  `similar_diff({project, login})` 返回能力矩阵。

## 测试与检查

```
pnpm lint            ✅ 0 warnings
pnpm typecheck       ✅
pnpm test:coverage   ✅ 285 passed（覆盖率门槛 45/44/42/34）
pnpm test:db         ✅ 33 passed
pnpm build           ✅
pnpm test:e2e        ✅（含新增的换库/贡献页渲染）
```

新增迁移：

| 迁移 | 用途 |
| --- | --- |
| `0008_patch_kind` | `patch_drafts.kind` 区分 issue / integration / swap |
| `0009_integration_impacts` | 接入回访记录与去重 |
| `0010_code_chunks` | 候选仓库代码块与向量索引 |

## 已知限制 / 建议下一步

1. **AI 相关路径需要真实 Key 才能完整验收**：单测用 stub 覆盖了解析与落库，但没有真实的模型输出质量评测。
   建议各跑一次真实任务，记录成功率。
2. **代码索引已到函数级**：worker 里用 tree-sitter（wasm）抽取函数/类边界，加载失败或语言不支持时
   退回启发式切块；`code_chunks.symbol` 支持按符号检索。
3. **接入回访已接入 OSV**：会从项目 lockfile 解析真实安装版本并按精确版本查询，
   解析不到时回退到按包查询；包名仍用仓库名近似、生态按语言推断。
4. **换库沙盘有两种模式**：模型产 diff，或「只做机械替换」用 Babel 重写 import；机械模式只改
   模块名、不做 API 映射，适合 API 兼容的替换。
5. **贡献雷达已加 10 分钟缓存**：失败时会退回上一次结果；多实例部署时每个实例各自缓存。
6. **MCP 可以触发任务**：`generate_*` 只负责排队，需要 worker 在运行；用 `get_job_status` 轮询。
