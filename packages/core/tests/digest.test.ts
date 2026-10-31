import { describe, expect, it } from 'vitest'
import { renderDigestHtml, renderDigestMarkdown, type DigestItem } from '../src/digest.js'

const items: DigestItem[] = [
  {
    fullName: 'acme/tool',
    htmlUrl: 'https://github.com/acme/tool',
    stars: 1234,
    language: 'TypeScript',
    summary: '一个用于测试的仓库',
    reason: '近期活跃',
    score: 0.87,
  },
]

describe('renderDigestMarkdown', () => {
  it('renders a titled list with project links', () => {
    const markdown = renderDigestMarkdown({
      items,
      userName: 'demo',
      date: new Date('2026-10-30T00:00:00Z'),
      baseUrl: 'https://radar.example.com',
    })
    expect(markdown).toContain('# RepoRadar 精选 — demo')
    expect(markdown).toContain('2026-10-30')
    expect(markdown).toContain('[acme/tool](https://github.com/acme/tool)')
    expect(markdown).toContain('https://radar.example.com/r/acme/tool')
    expect(markdown).toContain('> 近期活跃')
  })
})

describe('renderDigestHtml', () => {
  it('escapes user-supplied text', () => {
    const html = renderDigestHtml({
      items: [{ ...items[0]!, summary: '<script>alert(1)</script>' }],
      userName: 'demo',
    })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })
})
