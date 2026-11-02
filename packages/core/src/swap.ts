import type { LlmConfig } from './config.js'
import type { IntegrationProjectInput } from './integrations.js'
import { parseGeneratedPatch, type PatchCheckFn } from './patch.js'
import { chatCompletion } from './llm.js'

export interface SwapTrialInput {
  project: string
  projectContext: IntegrationProjectInput
  fromPackage: string
  toPackage: string
  targetFile?: { path: string; content: string } | null
  checkPatch?: PatchCheckFn
}

export interface GeneratedSwapTrial {
  summary: string
  files: string[]
  patch: string
}

const SWAP_SYSTEM_PROMPT = `你是一名迁移工程师。用户要把项目里的一个库替换成另一个库。
要求：
1. 在项目清单里移除旧依赖、加入新依赖（版本用兼容写法）；
2. 如果给了目标文件，替换其中的 import 和调用；没有给目标文件时只改清单；
3. 不要删除与替换无关的代码，不要改锁文件；
4. 不确定的 API 映射不要瞎猜，写进 summary 的「需要人工确认」里；
5. 输出标准 unified diff（git apply 可直接应用），路径用 a/ 和 b/ 前缀；
6. 只输出 JSON，不要 Markdown 围栏或解释。

输出格式：
{
  "summary": "改了什么、映射关系、需要人工确认的点",
  "files": ["package.json", "src/foo.ts"],
  "patch": "diff --git a/package.json b/package.json\\n--- a/package.json\\n+++ b/package.json\\n@@ ... @@\\n..."
}`

function buildSwapPrompt(input: SwapTrialInput): string {
  return JSON.stringify(
    {
      project: input.project,
      from_package: input.fromPackage,
      to_package: input.toPackage,
      language: input.projectContext.language,
      dependencies: input.projectContext.dependencies.slice(0, 40),
      manifest_file: input.projectContext.manifestName,
      manifest: input.projectContext.manifest?.slice(0, 6000) ?? null,
      readme_excerpt: input.projectContext.readme?.slice(0, 2000) ?? null,
      target_file: input.targetFile
        ? { path: input.targetFile.path, content: input.targetFile.content.slice(0, 8000) }
        : null,
    },
    null,
    2,
  )
}

/** 生成一份「换库」补丁；仍然交给 validatePatch 在沙箱里验证。 */
export async function generateSwapTrial(
  input: SwapTrialInput,
  llm: LlmConfig,
): Promise<GeneratedSwapTrial> {
  const prompt = buildSwapPrompt(input)
  const messages = [
    { role: 'system' as const, content: SWAP_SYSTEM_PROMPT },
    { role: 'user' as const, content: prompt },
  ]
  let raw = await chatCompletion(llm, messages, { temperature: 0.2, maxTokens: 6000, jsonMode: true })
  let lastError = '未知错误'
  for (let attempt = 0; attempt < 2; attempt++) {
    let report: GeneratedSwapTrial | null = null
    try {
      report = parseGeneratedPatch(raw)
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      console.error(`[swap-trial] 第 ${attempt + 1} 次输出解析失败：`, error, '\n', raw.slice(0, 900))
    }

    if (report) {
      const check = input.checkPatch ? await input.checkPatch(report.patch) : { ok: true }
      if (check.ok) return report
      lastError = check.error ?? '补丁无法应用'
      console.error(`[swap-trial] 第 ${attempt + 1} 次补丁检查失败：`, lastError)
    }

    if (attempt === 1) break
    raw = await chatCompletion(
      llm,
      [
        { role: 'system', content: SWAP_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `${prompt}\n\n上一次输出不可用：${lastError.slice(0, 300)}。请检查 unified diff 的 hunk 行数和上下文，重新输出 JSON。`,
        },
      ],
      { temperature: 0.1, maxTokens: 7000, jsonMode: true },
    )
  }
  throw new Error(`模型没有返回可应用的换库补丁（已自动重试）：${lastError.slice(0, 300)}`)
}
