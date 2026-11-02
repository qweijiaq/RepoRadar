import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Pool } from 'pg'
import { buildMechanicalSwapPatch } from '../src/codemod.js'
import type { LlmConfig } from '../src/config.js'
import { loadConfig } from '../src/config.js'
import { generateComparisonReport } from '../src/comparison.js'
import { generateIntegrationTrial } from '../src/integrations.js'
import { loadStoredLlmConfig } from '../src/llm-config.js'
import { estimateCost, loadLlmPrices, type LlmPriceMap } from '../src/llm-prices.js'
import { withLlmUsage, type LlmUsageEntry } from '../src/usage.js'

try {
  process.loadEnvFile('.env')
} catch {
  // .env 可选
}

interface ScenarioResult {
  model: string
  name: string
  ok: boolean
  durationMs: number
  inputTokens: number
  outputTokens: number
  cost: number | null
  detail: string
}

function usageTotals(usage: LlmUsageEntry[]): { inputTokens: number; outputTokens: number } {
  return {
    inputTokens: usage.reduce((sum, entry) => sum + entry.promptTokens, 0),
    outputTokens: usage.reduce((sum, entry) => sum + entry.completionTokens, 0),
  }
}

const project = 'acme/notes-cli'

const projectContext = {
  repo: project,
  description: 'A small TypeScript CLI for notes',
  language: 'TypeScript',
  topics: ['cli', 'typescript'],
  dependencies: ['commander', 'chalk'],
  readme: [
    '# notes-cli',
    '',
    'A small TypeScript CLI for taking notes. Commands are built with commander,',
    'output is colored with chalk. Run `notes add "text"` to append a note.',
  ].join('\n'),
  manifestName: 'package.json',
  manifest: JSON.stringify(
    {
      name: 'notes-cli',
      version: '0.3.0',
      type: 'module',
      dependencies: { commander: '^12.0.0', chalk: '^5.3.0' },
    },
    null,
    2,
  ) + '\n',
  lockfileName: 'package-lock.json',
  lockfile: JSON.stringify({
    lockfileVersion: 3,
    packages: {
      'node_modules/commander': { version: '12.1.0' },
      'node_modules/chalk': { version: '5.3.0' },
    },
  }),
}

const comparisonCandidates = [
  {
    repo: 'sindresorhus/execa',
    summary: 'Process execution for humans',
    language: 'JavaScript',
    topics: ['cli', 'process', 'nodejs'],
    stars: 8000,
    readme: '# execa\n\nProcess execution for humans. Promise-based child_process replacement.',
  },
  {
    repo: 'vercel/arg',
    summary: 'Simple argument parsing',
    language: 'JavaScript',
    topics: ['cli', 'arguments'],
    stars: 700,
    readme: '# arg\n\nA simple argument parser with a tiny API.',
  },
]

const trialCandidate = {
  repo: 'sindresorhus/execa',
  summary: 'Process execution for humans',
  language: 'JavaScript',
  topics: ['cli', 'process', 'nodejs'],
  stars: 8000,
}

const trialTarget = {
  path: 'src/run.ts',
  content: [
    "import { execFile } from 'node:child_process'",
    '',
    'export function run(command: string) {',
    '  execFile(command, [], () => undefined)',
    '}',
    '',
  ].join('\n'),
}

const swapManifest =
  JSON.stringify({ name: 'notes-cli', type: 'module', dependencies: { axios: '^1.6.0' } }, null, 2) +
  '\n'
const swapTarget = {
  path: 'src/http.ts',
  content: ["import axios from 'axios'", '', 'export const client = axios.create()', ''].join('\n'),
}

function tempRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'radar-ai-eval-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  return dir
}

function patchApplies(patch: string, files: Record<string, string>): { ok: boolean; error?: string } {
  const dir = tempRepo(files)
  try {
    writeFileSync(join(dir, 'change.patch'), patch)
    execFileSync('git', ['apply', '--check', 'change.patch'], { cwd: dir, stdio: 'pipe' })
    return { ok: true }
  } catch (error) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString()
    return { ok: false, error: (stderr ?? String(error)).slice(0, 400) }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function applyPatch(patch: string, files: Record<string, string>): Record<string, string> | null {
  const dir = tempRepo(files)
  try {
    writeFileSync(join(dir, 'change.patch'), patch)
    execFileSync('git', ['apply', 'change.patch'], { cwd: dir, stdio: 'pipe' })
    const result: Record<string, string> = {}
    for (const path of Object.keys(files)) {
      result[path] = readFileSync(join(dir, path), 'utf8')
    }
    return result
  } catch {
    return null
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function timedModel(
  model: string,
  name: string,
  run: () => Promise<{ ok: boolean; detail: string }>,
  prices: LlmPriceMap,
): Promise<ScenarioResult> {
  let usage: LlmUsageEntry[] = []
  const started = Date.now()
  const finish = (ok: boolean, detail: string): ScenarioResult => {
    const totals = usageTotals(usage)
    const price = prices[model]
    return {
      model,
      name,
      ok,
      durationMs: Date.now() - started,
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      cost: price ? estimateCost(totals.inputTokens, totals.outputTokens, price) : null,
      detail,
    }
  }

  try {
    const result = await withLlmUsage(run, async (entries) => {
      usage = entries
    })
    return finish(result.ok, result.detail)
  } catch (error) {
    return finish(false, error instanceof Error ? error.message.slice(0, 400) : String(error).slice(0, 400))
  }
}

async function comparisonScenario(llm: LlmConfig): Promise<{ ok: boolean; detail: string }> {
  const report = await generateComparisonReport(projectContext, comparisonCandidates, llm)
  const recommended = report.candidates.some((candidate) => candidate.repo === report.recommendation.repo)
  const ok = report.candidates.length >= 2 && report.capabilities.length >= 3 && recommended
  return {
    ok,
    detail: `候选 ${report.candidates.length} 个，能力行 ${report.capabilities.length}，推荐在候选内：${recommended}`,
  }
}

async function integrationScenario(llm: LlmConfig): Promise<{ ok: boolean; detail: string }> {
  const generated = await generateIntegrationTrial(
    {
      project,
      candidate: trialCandidate,
      projectContext,
      steps: ['把 child_process 的 execFile 调用换成 execa', '保持 run 的签名不变'],
      targetFile: trialTarget,
      checkPatch: (patch) => {
        const result = patchApplies(patch, {
          'package.json': projectContext.manifest,
          [trialTarget.path]: trialTarget.content,
        })
        return { ok: result.ok, error: result.error }
      },
    },
    llm,
  )
  const applied = patchApplies(generated.patch, {
    'package.json': projectContext.manifest,
    [trialTarget.path]: trialTarget.content,
  })
  if (!applied.ok) {
    mkdirSync('eval-results', { recursive: true })
    writeFileSync('eval-results/debug-integration.patch', generated.patch)
  }
  return {
    ok: applied.ok,
    detail: applied.ok
      ? `补丁可应用，改动 ${generated.files.length} 个文件`
      : `补丁无法应用：${applied.error ?? '未知错误'}`,
  }
}

async function swapScenario(): Promise<{ ok: boolean; detail: string }> {
  const generated = buildMechanicalSwapPatch({
    manifestName: 'package.json',
    manifest: swapManifest,
    targetFile: swapTarget,
    fromPackage: 'axios',
    toPackage: 'ofetch',
  })
  if (!generated) return { ok: false, detail: '机械补丁为空' }
  const files = applyPatch(generated.patch, {
    'package.json': swapManifest,
    [swapTarget.path]: swapTarget.content,
  })
  if (!files) return { ok: false, detail: '机械补丁无法应用' }
  const ok =
    files['package.json']?.includes('"ofetch"') === true &&
    files[swapTarget.path]?.includes("from 'ofetch'") === true
  return { ok, detail: ok ? '依赖和 import 都已替换' : '应用后内容不符合预期' }
}

const args = process.argv.slice(2)
const scenarioArg = args.find((arg) => arg.startsWith('--scenario='))?.split('=')[1] ?? 'all'
const scenarios = scenarioArg === 'all' ? ['comparison', 'integration', 'swap'] : [scenarioArg]
const unknown = scenarios.filter((item) => !['comparison', 'integration', 'swap'].includes(item))
if (unknown.length > 0) {
  console.error(`未知场景：${unknown.join(', ')}（可选 comparison / integration / swap / all）`)
  process.exit(2)
}

const needsLlm = scenarios.some((item) => item !== 'swap')
let llm: LlmConfig | null = null
if (needsLlm) {
  llm = loadConfig().llm
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://radar:radar@localhost:5433/radar',
  })
  if (!llm) {
    llm = await loadStoredLlmConfig(pool).catch(() => null)
  }
  await pool.end()
  if (!llm) {
    console.error('未找到模型配置：设置 LLM_API_KEY / LLM_BASE_URL / LLM_MODEL，或在设置页保存模型配置。')
    process.exit(2)
  }
}

const pricePool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://radar:radar@localhost:5433/radar',
})
const dbPrices: LlmPriceMap = await loadLlmPrices(pricePool).catch(() => ({}))
await pricePool.end()

// --prices="model:in:out,model2:in:out"（USD / 1M tokens）用于临时对比，不写库
const pricesArg = args.find((arg) => arg.startsWith('--prices='))?.split('=')[1]
const override: LlmPriceMap = {}
for (const part of pricesArg?.split(',') ?? []) {
  const [model, input, output] = part.split(':')
  if (model?.trim() && Number.isFinite(Number(input)) && Number.isFinite(Number(output))) {
    override[model.trim()] = { input: Number(input), output: Number(output) }
  }
}
const prices: LlmPriceMap = { ...dbPrices, ...override }

const modelArg = args.find((arg) => arg.startsWith('--models='))?.split('=')[1]
const requestedModels = modelArg
  ? modelArg
      .split(',')
      .map((model) => model.trim())
      .filter(Boolean)
  : []
const models = needsLlm ? [...new Set(requestedModels.length > 0 ? requestedModels : [llm!.model])] : []
const repeat = Math.max(
  1,
  Math.min(5, Number(args.find((arg) => arg.startsWith('--repeat='))?.split('=')[1] ?? 1) || 1),
)

const results: ScenarioResult[] = []
for (const model of models) {
  const modelLlm: LlmConfig = { ...llm!, model }
  for (const scenario of scenarios) {
    if (scenario === 'swap') continue
    for (let run = 1; run <= repeat; run++) {
      const label = repeat > 1 ? `${scenario}#${run}` : scenario
      if (scenario === 'comparison') {
        results.push(await timedModel(model, label, () => comparisonScenario(modelLlm), prices))
      } else {
        results.push(await timedModel(model, label, () => integrationScenario(modelLlm), prices))
      }
    }
  }
}
if (scenarios.includes('swap')) {
  results.push(await timedModel('mechanical', 'swap', swapScenario, prices))
}

const summaries = models.map((model) => {
  const rows = results.filter((result) => result.model === model && result.name !== 'swap')
  const passed = rows.filter((result) => result.ok).length
  const inputTokens = rows.reduce((sum, result) => sum + result.inputTokens, 0)
  const outputTokens = rows.reduce((sum, result) => sum + result.outputTokens, 0)
  const durationMs = rows.reduce((sum, result) => sum + result.durationMs, 0)
  const price = prices[model]
  return {
    model,
    passed,
    total: rows.length,
    inputTokens,
    outputTokens,
    durationMs,
    cost: price ? estimateCost(inputTokens, outputTokens, price) : null,
  }
})

const recommended = [...summaries].sort((left, right) => {
  if (right.passed !== left.passed) return right.passed - left.passed
  // 两边都有价格才比较成本；都没有时按耗时兜底（避免 Infinity - Infinity = NaN）。
  if (left.cost !== null && right.cost !== null) {
    const costDiff = left.cost - right.cost
    if (costDiff !== 0) return costDiff
  }
  return left.durationMs - right.durationMs
})[0]

const passed = results.filter((result) => result.ok).length
const minPass = Math.max(1, Number(process.env.AI_EVAL_MIN_PASS ?? Math.ceil(results.length * 0.7)))
const report = {
  generatedAt: new Date().toISOString(),
  recommended: recommended?.model ?? null,
  models: summaries,
  passed,
  total: results.length,
  results,
}

mkdirSync('eval-results', { recursive: true })
const stamp = report.generatedAt.replace(/[:.]/g, '-')
const jsonPath = join('eval-results', `ai-${stamp}.json`)
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`)

const money = (value: number | null) => (value === null ? '—' : `$${value.toFixed(4)}`)

const lines = [
  `# AI 质量与成本对比 · ${report.generatedAt}`,
  '',
  recommended ? `推荐模型：**${recommended.model}**（通过数优先，成本次之）` : '',
  '',
  '| 模型 | 通过 | 耗时 | 输入 tokens | 输出 tokens | 估算成本 |',
  '| --- | --- | ---: | ---: | ---: | ---: |',
  ...summaries.map(
    (item) =>
      `| ${item.model} | ${item.passed}/${item.total} | ${(item.durationMs / 1000).toFixed(1)}s | ${item.inputTokens.toLocaleString('en-US')} | ${item.outputTokens.toLocaleString('en-US')} | ${money(item.cost)} |`,
  ),
  '',
  '## 明细',
  '',
  '| 模型 | 场景 | 结果 | 耗时 | tokens（输入/输出） | 成本 | 说明 |',
  '| --- | --- | --- | ---: | --- | ---: | --- |',
  ...results.map(
    (result) =>
      `| ${result.model} | ${result.name} | ${result.ok ? '✅' : '❌'} | ${(result.durationMs / 1000).toFixed(1)}s | ${result.inputTokens} / ${result.outputTokens} | ${money(result.cost)} | ${result.detail.replace(/\|/g, '\\|')} |`,
  ),
  '',
]
const mdPath = join('eval-results', `ai-${stamp}.md`)
writeFileSync(mdPath, lines.join('\n'))

console.log(lines.join('\n'))
console.log(`报告已写入 ${jsonPath} 和 ${mdPath}`)
process.exit(passed >= minPass ? 0 : 1)
