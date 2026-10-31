import { describe, expect, it } from 'vitest'
import { heuristicQuality, parseEnrichment } from '../src/enrich.js'
import type { RepoInput } from '../src/types.js'

const validPayload = {
  one_liner: '一个用于管理仓库的 CLI 工具',
  problem: '解决仓库运营自动化问题',
  audience: '独立开发者',
  verdict: 'recommend',
  reason: '活跃、有测试、文档清晰',
  quality: { real_code: true, docs: 'good', tests: true, ci: true },
}

const NOW = Date.parse('2026-10-30T00:00:00Z')

describe('parseEnrichment', () => {
  it('parses JSON wrapped in a code fence', () => {
    const raw = '```json\n' + JSON.stringify(validPayload) + '\n```'
    expect(parseEnrichment(raw)).toMatchObject({ verdict: 'recommend' })
  })

  it('parses JSON embedded in surrounding text', () => {
    const raw = `评审结果如下：${JSON.stringify(validPayload)} 以上。`
    expect(parseEnrichment(raw)).not.toBeNull()
  })

  it('rejects non-JSON output', () => {
    expect(parseEnrichment('这不是 JSON')).toBeNull()
  })

  it('rejects payloads missing required fields', () => {
    expect(parseEnrichment('{"one_liner":"x"}')).toBeNull()
  })
})

describe('heuristicQuality', () => {
  const base: RepoInput = {
    fullName: 'acme/tool',
    owner: 'acme',
    name: 'tool',
    description: '一个用于测试启发式评分的仓库描述文本',
    htmlUrl: 'https://github.com/acme/tool',
    homepage: null,
    language: 'TypeScript',
    topics: ['cli', 'tool'],
    stars: 120,
    forks: 10,
    openIssues: 3,
    license: 'MIT',
    archived: false,
    isFork: false,
    pushedAt: '2026-10-20T00:00:00Z',
    createdAt: '2024-01-01T00:00:00Z',
  }

  it('scores a healthy, recently pushed repo highly', () => {
    const { score, detail } = heuristicQuality(base, NOW)
    expect(score).toBeGreaterThanOrEqual(0.8)
    expect(detail.recentPush).toBe(true)
    expect(detail.license).toBe(true)
  })

  it('penalises archived repos without license or recent activity', () => {
    const stale: RepoInput = {
      ...base,
      license: null,
      archived: true,
      pushedAt: '2020-01-01T00:00:00Z',
      topics: [],
      stars: 1,
      openIssues: 0,
    }
    const { score } = heuristicQuality(stale, NOW)
    expect(score).toBeLessThanOrEqual(0.3)
  })
})
