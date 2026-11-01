import { Pool } from 'pg'
import { enrichRepo } from '../src/enrich.js'
import { loadConfig } from '../src/config.js'
import { loadStoredLlmConfig } from '../src/llm-config.js'
import type { RepoInput } from '../src/types.js'
import { enrichEvalCases, type EnrichEvalCase } from './fixtures.js'

try {
  process.loadEnvFile('.env')
} catch {
  // .env 可选；CI 或手动执行时可以直接传环境变量
}

function buildRepo(testCase: EnrichEvalCase): RepoInput {
  return {
    owner: testCase.repo.owner ?? testCase.repo.fullName.split('/')[0]!,
    name: testCase.repo.name ?? testCase.repo.fullName.split('/')[1]!,
    description: null,
    htmlUrl: `https://github.com/${testCase.repo.fullName}`,
    homepage: null,
    language: null,
    topics: [],
    stars: 0,
    forks: 0,
    openIssues: 0,
    license: null,
    archived: false,
    isFork: false,
    pushedAt: null,
    createdAt: null,
    ...testCase.repo,
  }
}

let llm = loadConfig().llm
if (!llm) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://radar:radar@localhost:5433/radar',
  })
  llm = await loadStoredLlmConfig(pool).catch(() => null)
  await pool.end()
}
if (!llm) {
  console.error(
    '未找到模型配置。可以设置 LLM_API_KEY / LLM_BASE_URL / LLM_MODEL，或先在本机设置页保存模型配置。',
  )
  process.exit(2)
}

let passed = 0
console.log(`LLM 评测：${enrichEvalCases.length} 个样本 · ${llm.model}\n`)

for (const testCase of enrichEvalCases) {
  const result = await enrichRepo(buildRepo(testCase), { llm, readme: testCase.readme })
  const verdictOk = testCase.allowedVerdicts.includes(result.verdict)
  const qualityOk =
    (testCase.minQuality === undefined || result.qualityScore >= testCase.minQuality) &&
    (testCase.maxQuality === undefined || result.qualityScore <= testCase.maxQuality)
  const ok = verdictOk && qualityOk
  if (ok) passed += 1
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${testCase.name.padEnd(22)} ` +
      `verdict=${result.verdict.padEnd(9)} quality=${result.qualityScore.toFixed(2)} ` +
      `expected=${testCase.allowedVerdicts.join('/')}` +
      (testCase.minQuality !== undefined ? ` min=${testCase.minQuality}` : '') +
      (testCase.maxQuality !== undefined ? ` max=${testCase.maxQuality}` : ''),
  )
  if (!verdictOk || !qualityOk) {
    console.log(`      summary: ${result.summary}`)
    console.log(`      reason: ${result.reason}`)
    if (testCase.note) console.log(`      note: ${testCase.note}`)
  }
}

const rate = passed / enrichEvalCases.length
console.log(`\n通过 ${passed}/${enrichEvalCases.length}（${Math.round(rate * 100)}%），阈值 80%`)
if (rate < 0.8) process.exit(1)
