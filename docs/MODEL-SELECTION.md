# 默认模型选择（2026-11-02）

## 结论

AI 生成类任务（试接入、换库、选型对比）**默认继续使用 `deepseek-flash`**。

`deepseek-chat` 快约 4 倍、输出 token 少约 4 倍，但在 3 次试接入里有 1 次生成的补丁无法应用。
在质量优先、且目前没有「补丁失败自动重试」的前提下，不切换默认模型。

## 数据

复现命令（同一 provider / baseUrl，只覆盖 `model` 字段）：

```bash
pnpm eval:ai -- --models=deepseek-flash,deepseek-chat --repeat=3
```

| 模型 | 通过 | 总耗时 | 输入 tokens | 输出 tokens |
| --- | --- | ---: | ---: | ---: |
| deepseek-flash | 6/6 | 132.9s | 5,578 | 21,999 |
| deepseek-chat | 5/6 | 31.6s | 4,479 | 5,244 |

明细里的唯一失败：

- `deepseek-chat` → `integration#1`：补丁在 `change.patch:24` 损坏，`git apply` 拒绝。

对比场景两个模型都是 3/3，差异集中在试接入补丁的可应用性上。
原始报告写在 `eval-results/ai-2026-11-02T02-54-15-351Z.md`（本地生成，已 gitignore）。

## 判断依据

- **质量**：`deepseek-flash` 6/6；`deepseek-chat` 5/6。一次补丁损坏就是一次用户可见的失败。
- **速度**：`deepseek-chat` 31.6s，`deepseek-flash` 132.9s（约 4 倍差距，主要来自对比场景）。
- **token**：`deepseek-chat` 输出 5.2k，`deepseek-flash` 22k，chat 明显更省。
- **成本**：`/ops` 还没配置单价，报告里成本为空；按 token 量估算 chat 更便宜。

结论是「质量优先」：先用稳定的模型，等失败重试和更多样本到位后再考虑把 chat 作为快速模式。

## 何时重新评估

- 给试接入 / 换库补上「补丁应用失败后带错误重试一次」；
- 用 `--repeat=5` 或更多 fixture 扩大样本；
- 在 `/ops` 配置真实单价后，用成本列重新排序；
- 引入第三个候选模型时重新跑同一命令。

## 说明

`gpt-4o-mini` 仍是代码里未配置 `LLM_MODEL` 时的 OpenAI 默认值；本结论针对当前
DeepSeek 部署和推荐配置，不改变其他 provider 的默认行为。
