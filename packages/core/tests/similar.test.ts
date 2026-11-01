import { describe, expect, it } from 'vitest'
import { buildSimilarBrief, groundSimilarReport, parseSimilarReport } from '../src/similar.js'

const raw = JSON.stringify({
  project: 'me/app',
  summary: '对方在插件生态上更强，但目标项目的本地优先定位更清晰。',
  candidates: [
    {
      repo: 'acme/similar',
      similarity: 88,
      overview: '一个同类的本地优先工具。',
      candidateStrengths: ['插件生态更完整'],
      candidateWeaknesses: ['安装流程更复杂'],
      targetAdvantages: ['桌面与 CLI 共享会话'],
      borrowable: ['按功能拆分插件目录', '增加命令面板'],
      risks: ['直接引入会增加打包体积'],
    },
  ],
  nextSteps: ['先读对方插件接口文档', '实现一个最小插件验证'],
})

describe('similar report', () => {
  it('parses and grounds a similar project report', () => {
    const parsed = parseSimilarReport(`\`\`\`json\n${raw}\n\`\`\``)
    expect(parsed.candidates).toHaveLength(1)
    const grounded = groundSimilarReport(
      parsed,
      {
        repo: 'me/app',
        description: 'target',
        language: 'TypeScript',
        topics: ['cli'],
        readme: null,
        manifestName: null,
        manifest: null,
      },
      [
        {
          repo: 'acme/similar',
          description: 'candidate',
          language: 'TypeScript',
          topics: ['cli'],
          readme: null,
          manifestName: null,
          manifest: null,
          similarity: 0.734,
          stars: 100,
        },
      ],
    )
    expect(grounded.candidates[0]?.similarity).toBe(73)
    const brief = buildSimilarBrief({
      report: grounded,
      generatedAt: '2026-11-01T00:00:00.000Z',
    })
    expect(brief).toContain('借鉴')
  })
})
