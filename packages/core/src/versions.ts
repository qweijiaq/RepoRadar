/**
 * 评分和提示词的版本号。报告、用量记录和评测结果都带上它们，
 * 便于在换模型或改提示词后解释结果差异。
 */
export const SCORING_VERSION = 'score@1'

export const PROMPT_VERSIONS = {
  enrich: 'enrich@1',
  integration: 'integration@1',
  maintainer: 'maintainer@1',
  issue: 'issue@1',
  discoverability: 'discoverability@1',
  comparison: 'comparison@1',
  'issue-plan': 'issue-plan@1',
  watch: 'watch@1',
  similar: 'similar@1',
  copilot: 'copilot@1',
} as const

export type PromptKind = keyof typeof PROMPT_VERSIONS

export function promptVersionForJob(kind: string): string | null {
  return (PROMPT_VERSIONS as Record<string, string>)[kind] ?? null
}
