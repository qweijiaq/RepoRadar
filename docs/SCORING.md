# 评分与可解释性

RepoRadar 的推荐分数是排序信号，不是对项目质量的最终判决。每个分数都可以拆成基础分、个人匹配和调整项，工具库卡片上的「为什么是这个分数」会展示主要贡献。

## 基础分

基础分只依赖仓库本身，权重固定为：

| 维度 | 权重 | 含义 |
| --- | --- | --- |
| 质量 | 0.50 | 许可证、近期推送、描述、topics、homepage、stars、归档状态，以及模型 verdict |
| 新鲜度 | 0.25 | 最近一次推送距今天数；90 天内线性衰减 |
| 增速 | 0.25 | 近 7 天 star 相对增速；没有基线时给中性 0.5 |

质量分先由 `heuristicQuality` 计算，模型 verdict 会把它和 `recommend/neutral/skip` 的映射值做平均。没有模型时使用启发式结果。

## 个人匹配

有口味画像时，总分按以下方式混合：

```text
total = 0.55 × affinity + 0.45 × global + adjustments
```

`affinity` 由三部分组成：

- 语义相似度（有 embedding 时 0.50）
- topic 亲和度（0.35）
- 语言亲和度（0.15）

没有 embedding 时退化为 `0.70 × topic + 0.30 × language`。

## 调整项

- 收藏过的仓库：`+0.08`；
- topic 反馈：每条保存/不感兴趣信号按 topic 累计，单 topic 最多 ±0.15，再对仓库 topic 取平均；
- 订阅命中：topic `+0.07`、language `+0.04`、author `+0.10`、release `+0.05`，总计最多 `+0.20`；
- 标记「不感兴趣」的仓库直接返回 `-1`，不会进入推荐。

调整后总分会被限制在 `0–1`。

## 版本与评测

- 当前评分版本：`score@1`；
- 富化提示词版本：`enrich@1`；
- 报告会记录 `promptVersion`，`llm_usage` 会记录 `prompt_version` 和 `score_version`，方便解释换模型或改提示词后的差异；
- `quality_detail` 也会保存 `promptVersion` 和 `scoreVersion`。

固定评测集：

```bash
pnpm eval:llm
```

使用环境变量里的模型配置，或本机设置页保存的模型。默认 6 个固定 README 样本，检查 verdict 是否落在允许范围、质量分是否在预期区间；通过率低于 80% 时命令失败。CI 里运行的是不调用模型的提示词/解析契约测试，避免产生费用和波动。

评测样本在 [packages/core/eval/fixtures.ts](../packages/core/eval/fixtures.ts)，prompt 在 [packages/core/src/enrich.ts](../packages/core/src/enrich.ts)。

已有仓库可以用 `pnpm radar backfill-identities` 回填 GitHub 稳定 ID；新采集的仓库会自动带上 `github_id`，改名/转移后会更新原记录而不是新建一条。

## 查看具体分数

在 `/feed?tab=library` 的工具库卡片上展开「为什么是这个分数」，可以看到质量、新鲜度、增速、个人匹配和反馈/订阅的贡献。精选页的机会卡和隐藏宝石使用不同的排序信号，不显示这个面板。
