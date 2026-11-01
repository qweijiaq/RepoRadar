# AI 功能路线图

本文件把「接入建议」和「相似项目」两条主线上的 8 个 AI 功能拆成可执行的规格。
第 1 项已经实现；其余按依赖关系排序，每项都写清楚数据、流程、验收和风险。

## 已实现

### 1. 接入预演（Integration Dry-Run）

- 入口：`/workbench/integrations` 每条建议上的「试接入（沙箱预演）」。
- 流程：worker 任务 `integration-trial` → 读取项目上下文 → 模型生成试接入补丁（加依赖，必要时加最小调用）
  → `validatePatch` 在 Docker 沙箱里 `git apply --check` + install/build → 结果存 `patch_drafts`（`kind = 'integration'`）
  → 通知 + `/patch/<id>` 查看 diff、命令和构建日志。
- 关键代码：`generateIntegrationTrial`（`packages/core/src/integrations.ts`）、`integrationTrialJob`
  （`apps/worker/src/ai-jobs/handlers.ts`）、`enqueueIntegrationTrialAction`。
- 当前范围：只改清单，不做业务代码接线（`targetFile` 参数已预留）。

---

## 待实现

### 2. 适配层生成（Adapter Synthesis）

**目标**：在试接入补丁里生成可编译的适配层，而不只是加依赖。

- 数据：复用 `integration_trials` 的补丁存储；新增 `patch_drafts.target_file` 记录接入点。
- 流程：用户在预演表单里可选填「接入文件」→ worker 拉取该文件内容 → 提示词要求同时输出
  适配文件（如 `src/lib/vendor-x.ts`）和调用点修改 → 沙箱跑 `tsc`/测试。
- 依赖：第 1 项 + `fetchRepoFile` + 类型定义获取（npm tarball 或仓库 `.d.ts`）。
- 验收：一个真实项目里生成适配层后 `tsc --noEmit` 通过，且至少一个调用点被接上。
- 风险：模型容易生成"看起来对但类型不匹配"的代码；必须依赖沙箱类型检查兜底。

### 3. 接入后回访（Impact Radar）

**目标**：已接入的库发新版/出 CVE 时，主动通知并给出受影响文件与验证过的升级补丁。

- 数据：`integration_outcomes` 增加 `repo_version`、`adopted_at`、`touched_files`；
  新增 `integration_impacts(id, user_id, project, package, kind, version, advisory, status, created_at)`。
- 流程：worker 每轮检查 `adopted` 的接入 → 查最新 release / OSV → 命中后生成通知
  → 用现有 `upgrade.ts` 在沙箱验证升级补丁 → 通知里直接给 `/patch/<id>`。
- 依赖：`dependency-radar`、`osv`、`upgrade`、`notifications`。
- 验收：订阅一个库后，新版本发布 30 分钟内收到一次通知，且附带的补丁能在沙箱构建通过。
- 风险：通知噪音。需要按项目/包去重，并提供"只通知 major/CVE"的偏好。

### 4. 能力差异矩阵（Capability Diff）

**目标**：把相似项目对比从散文变成结构化能力表，并定位可借鉴的实现。

- 数据：`comparison_reports.payload` 增加 `capabilities: Array<{name, a, b, diff, evidence}>`。
- 流程：模型输出严格 schema；页面渲染表格；有差异的项用 GitHub 代码搜索补 `evidence`（文件路径/链接）。
- 依赖：现有 `comparison.ts` + `github.ts`（搜索 API 需限流）。
- 验收：同一对仓库重复生成时，能力项对齐稳定（±1 项），每项至少一条证据链接。
- 风险：能力项命名不一致导致对齐漂移；需要固定一组候选维度（API、生态、性能、维护性、许可证）。

### 5. 代码级证据（Code-Grounded Advice）

**目标**：接入建议/相似对比引用真实函数，而不只是 README。

- 数据：新增 `code_chunks(repo_full_name, path, symbol, content, embedding vector(1536), commit_sha, updated_at)`。
- 流程：沙箱 clone（已有）→ tree-sitter 切函数级 chunk（只索引入口文件、导出符号、examples）
  → embedding 入库 → 生成报告时按查询检索 top-k 片段拼进提示词。
- 依赖：`sandbox.ts`、pgvector、`llm.embedText`。
- 验收：对一个真实仓库，接入步骤里引用的函数名能在代码里找到。
- 风险：索引成本与仓库更新；先只索引 `package.json` 的 `exports` 指向的入口和 `examples/`。

### 6. 换库沙盘（Swap Lab）

**目标**：把相似推荐变成可执行的迁移方案（codemod + 测试）。

- 数据：复用 `patch_drafts`（`kind = 'swap'`），新增 `swap_plans(id, user_id, project, from_pkg, to_pkg, mapping jsonb, status)`。
- 流程：选当前库 + 替代库 → 模型生成 API 映射表 → 在沙箱里做机械替换并修类型错误
  → 跑测试 → 输出"改动文件数 / 测试结果 / 包体积变化 / 不兼容点"。
- 依赖：第 2 项的适配层能力 + 沙箱测试。
- 验收：一个只用了 3–5 个 API 的库能自动迁移且测试通过；否则明确列出阻塞点。
- 风险：codemod 的语义正确性；初期只支持"调用点少、API 稳定"的库。

### 7. 贡献雷达（Contribution Radar）

**目标**：用相似度找到"你能补缺口"的项目，生成可提 PR 的改动。

- 数据：新增 `contribution_candidates(id, user_id, repo, issue_number, fit_score, reason, status)`。
- 流程：相似项目 × 开放 issue × 你维护项目里已有的实现 → 匹配度排序
  → 生成修复方案（复用 `issue-plan`）→ 沙箱验证补丁 → 输出 PR 草稿（不自动提交）。
- 依赖：`similar.ts`、`issue-plan.ts`、`patch.ts`、`sandbox.ts`。
- 验收：对 10 个候选给出至少 3 个"我确实能改"的建议，其中 1 个补丁在沙箱通过。
- 风险：贡献机会的质量和时效；需要按 issue 的 `good first issue`/`help wanted` 预筛。

### 8. MCP 决策中间件（Radar for Agents）

**目标**：让 Claude Code / Cursor 在写代码时直接调用雷达的决策能力。

- 数据：无新表；复用现有报告。
- 流程：在 `apps/worker/src/mcp-server.ts` 增加工具：
  `radar.pick_library(task, constraints)`（返回 3 个候选 + 理由）、
  `radar.integration_preflight(project, candidate)`（返回第 1 项的预演结果）、
  `radar.similar_diff(a, b)`（返回第 4 项的能力矩阵）。
- 依赖：第 1、4 项；MCP server 已存在。
- 验收：在真实 MCP 客户端里走通"问 → 选库 → 预演 → 拿到补丁"一条链路。
- 风险：工具返回内容要控制长度，否则会挤爆 agent 上下文。

---

## 建议顺序

1. **2 适配层生成**：是 1 的自然延伸，复用最多。
2. **3 接入后回访**：把一次性推荐变成持续价值，数据管道基本就绪。
3. **4 能力差异矩阵**：相似线体验升级，成本可控。
4. **5 代码级证据**：2/4/6 的质量地基。
5. **6 换库沙盘**、**7 贡献雷达**：价值最高、工程量最大，放在地基之后。
6. **8 MCP 中间件**：等 1、4 稳定后接入，作为分发渠道。
