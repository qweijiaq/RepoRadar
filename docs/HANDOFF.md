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
2. **代码索引已到函数级**：按导出符号（function/class/const arrow/def/func/fn）切块并记录
   `symbol`，检索支持按符号名匹配；仍是启发式切块而非 AST，极端写法可能切不准确。
3. **接入回访已接入 OSV**：会从项目 lockfile 解析真实安装版本并按精确版本查询，
   解析不到时回退到按包查询；包名仍用仓库名近似、生态按语言推断。
4. **换库沙盘没有 codemod**：当前是模型直接产出 diff，适合小范围迁移；大规模迁移需要 AST 级工具。
5. **贡献雷达已加 10 分钟缓存**：失败时会退回上一次结果；多实例部署时每个实例各自缓存。
6. **MCP 工具读的是已存报告**：不会现场生成；如果希望 agent 触发一次生成，需要再加一个异步任务工具。
