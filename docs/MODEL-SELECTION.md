# 默认模型选择（2026-11-02）

## 结论（已按重试后的数据修订）

AI 生成类任务（试接入、换库、选型对比）**推荐默认使用 `deepseek-chat`**，`deepseek-flash` 作为备选。

加入「补丁不可应用时带错误重试一次」之后，两个模型在 3 次重复里都是 **6/6**；
`deepseek-chat` 总耗时 35.1s，`deepseek-flash` 163.3s（约 4.6 倍差距），
输出 tokens 6,290 vs 27,734（约 4.4 倍差距）。质量打平时，速度和 token 都明显占优。

## 数据

复现命令（同一 provider / baseUrl，只覆盖 `model` 字段）：

```bash
pnpm eval:ai -- --models=deepseek-flash,deepseek-chat --repeat=3
```

| 模型 | 通过 | 总耗时 | 输入 tokens | 输出 tokens |
| --- | --- | ---: | ---: | ---: |
| deepseek-flash | 6/6 | 163.3s | 5,578 | 27,734 |
| deepseek-chat | 6/6 | 35.1s | 5,743 | 6,290 |

修订前的数据（没有重试时）：flash 6/6（132.9s），chat 5/6（31.6s，一次补丁损坏）——这正是加重试的原因。

重试后的明细：两个模型的对比场景都是 3/3，试接入场景也都是 3/3；
`deepseek-chat` 有两次试接入触发了重试（输入 tokens 约 1,228，正常是 596），但总耗时仍然最低。
对比场景两个模型都是 3/3，差异集中在速度和 token 上。
原始报告写在 `eval-results/ai-2026-11-02T03-08-38-128Z.md`（本地生成，已 gitignore）。

## 判断依据

- **质量**：重试后都是 6/6，打平。
- **速度**：`deepseek-chat` 35.1s，`deepseek-flash` 163.3s（约 4.6 倍，主要差在对比场景）。
- **token**：`deepseek-chat` 输出 6.3k，`deepseek-flash` 27.7k，chat 明显更省。
- **成本**：`/ops` 还没配置单价，报告里成本为空；按 token 量估算 chat 更便宜。
- **稳定性**：chat 的补丁更短，偶尔会产出结构损坏的 diff；重试后能恢复，代价是多一次调用。

结论：质量打平后选更快、更省的 `deepseek-chat`；保留 `deepseek-flash` 作为重试仍失败时的备选。

## 如何应用

在设置页把模型改为 `deepseek-chat`，或设置 `LLM_MODEL=deepseek-chat`。

**2026-11-02 已切换并验证**：

- 当前部署保存的模型配置已从 `deepseek-flash` 改为 `deepseek-chat`（`radar doctor` 可见）。
- 用默认配置复跑 `pnpm eval:ai -- --repeat=3`：**6/6**，36.1s，输入 5,111 / 输出 5,544 tokens。
- 真实仓库验证：项目 `vercel/arg` + 候选 `sindresorhus/meow`，1.7s 生成补丁，`git apply` 成功，
  `package.json` 增加 `"meow": "^10.1.5"`（未提供目标文件，只改清单）。
- 本机 `GITHUB_TOKEN` 为空且 git 克隆被网络限制，所以没有跑通「克隆 + Docker 构建」；
  补丁对真实清单的应用已验证，完整沙箱验证需要在有 token 和 Docker 网络的环境执行。

## 何时重新评估

- 用 `--repeat=5` 或更多 fixture 扩大样本；
- 观察生产环境里 chat 的补丁重试率（`/ops` 的任务失败原因）；
- 在 `/ops` 配置真实单价后，用成本列重新排序；
- 引入第三个候选模型时重新跑同一命令。

## 说明

`gpt-4o-mini` 仍是代码里未配置 `LLM_MODEL` 时的 OpenAI 默认值；本结论针对当前
DeepSeek 部署和推荐配置，不改变其他 provider 的默认行为。
