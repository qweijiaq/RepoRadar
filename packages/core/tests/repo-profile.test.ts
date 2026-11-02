import { describe, expect, it } from 'vitest'
import { parseRepoProfile, repoProfileSourceHash } from '../src/repo-profile.js'

const valid = {
  positioning: '一个把命令行参数解析成结构化对象的轻量库。',
  features: [
    { name: '参数解析', detail: '支持短选项、长选项和默认值。' },
    { name: '类型推导', detail: '返回带类型的解析结果。' },
    { name: '错误提示', detail: '参数缺失时给出可读错误。' },
  ],
  useCases: ['写 Node CLI', '需要零依赖的小工具'],
  notFor: ['复杂子命令场景'],
  quickstart: ['npm i arg', 'const args = arg({})'],
}

describe('parseRepoProfile', () => {
  it('parses a valid profile, with or without fences', () => {
    expect(parseRepoProfile(JSON.stringify(valid))).toEqual(valid)
    expect(parseRepoProfile('```json\n' + JSON.stringify(valid) + '\n```')).toEqual(valid)
  })

  it('rejects profiles with too few features', () => {
    expect(() =>
      parseRepoProfile(JSON.stringify({ ...valid, features: valid.features.slice(0, 2) })),
    ).toThrow(/结构不符合要求/)
  })

  it('rejects non-JSON output', () => {
    expect(() => parseRepoProfile('这不是 JSON')).toThrow(/无法解析/)
  })
})

describe('repoProfileSourceHash', () => {
  it('is stable for the same content and changes with the readme', () => {
    expect(repoProfileSourceHash('a', 'b')).toBe(repoProfileSourceHash('a', 'b'))
    expect(repoProfileSourceHash('a', 'b')).not.toBe(repoProfileSourceHash('a2', 'b'))
    expect(repoProfileSourceHash(null, null)).toBe(repoProfileSourceHash(null, null))
  })
})
