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

try {
  process.loadEnvFile('.env')
} catch {
  // .env 可选
}

interface ScenarioResult {
  name: string
  ok: boolean
  durationMs: number
  detail: string
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

async function timed(name: string, run: () => Promise<{ ok: boolean; detail: string }>): Promise<ScenarioResult> {
  const started = Date.now()
  try {
    const result = await run()
    return { name, ok: result.ok, durationMs: Date.now() - started, detail: result.detail }
  } catch (error) {
    return {
      name,
      ok: false,
      durationMs: Date.now() - started,
      detail: error instanceof Error ? error.message.slice(0, 400) : String(error).slice(0, 400),
    }
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
  if (!llm) {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL || 'postgres://radar:radar@localhost:5433/radar',
    })
    llm = await loadStoredLlmConfig(pool).catch(() => null)
    await pool.end()
  }
  if (!llm) {
    console.error('未找到模型配置：设置 LLM_API_KEY / LLM_BASE_URL / LLM_MODEL，或在设置页保存模型配置。')
    process.exit(2)
  }
}

const results: ScenarioResult[] = []
for (const scenario of scenarios) {
  if (scenario === 'comparison') {
    results.push(await timed('comparison', () => comparisonScenario(llm!)))
  } else if (scenario === 'integration') {
    results.push(await timed('integration', () => integrationScenario(llm!)))
  } else {
    results.push(await timed('swap', swapScenario))
  }
}

const passed = results.filter((result) => result.ok).length
const minPass = Math.max(1, Number(process.env.AI_EVAL_MIN_PASS ?? Math.ceil(results.length * 0.7)))
const report = {
  generatedAt: new Date().toISOString(),
  model: llm?.model ?? 'mechanical',
  passed,
  total: results.length,
  results,
}

mkdirSync('eval-results', { recursive: true })
const stamp = report.generatedAt.replace(/[:.]/g, '-')
const jsonPath = join('eval-results', `ai-${stamp}.json`)
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`)

const lines = [
  `# AI 质量评测 · ${report.generatedAt}`,
  '',
  `模型：${report.model}`,
  '',
  `通过：${passed}/${results.length}`,
  '',
  '| 场景 | 结果 | 耗时 | 说明 |',
  '| --- | --- | ---: | --- |',
  ...results.map(
    (result) =>
      `| ${result.name} | ${result.ok ? '✅' : '❌'} | ${(result.durationMs / 1000).toFixed(1)}s | ${result.detail.replace(/\|/g, '\\|')} |`,
  ),
  '',
]
const mdPath = join('eval-results', `ai-${stamp}.md`)
writeFileSync(mdPath, lines.join('\n'))

console.log(lines.join('\n'))
console.log(`报告已写入 ${jsonPath} 和 ${mdPath}`)
process.exit(passed >= minPass ? 0 : 1)
