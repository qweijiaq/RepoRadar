import { describe, expect, it } from 'vitest'
import { ENRICH_SYSTEM_PROMPT, buildEnrichmentPrompt } from '../src/enrich.js'
import type { RepoInput } from '../src/types.js'
import { PROMPT_VERSIONS, SCORING_VERSION } from '../src/versions.js'

const repo: RepoInput = {
  fullName: 'acme/tool',
  owner: 'acme',
  name: 'tool',
  description: 'A small CLI for testing',
  htmlUrl: 'https://github.com/acme/tool',
  homepage: null,
  language: 'TypeScript',
  topics: ['cli'],
  stars: 10,
  forks: 1,
  openIssues: 0,
  license: 'MIT',
  archived: false,
  isFork: false,
  pushedAt: '2026-10-30T00:00:00Z',
  createdAt: '2025-01-01T00:00:00Z',
}

describe('enrichment prompt contract', () => {
  it('asks for the structured enrichment fields', () => {
    const prompt = buildEnrichmentPrompt(repo, 'README body')
    expect(ENRICH_SYSTEM_PROMPT).toContain('JSON')
    expect(prompt).toContain('acme/tool')
    expect(prompt).toContain('README body')
    for (const field of ['one_liner', 'problem', 'audience', 'verdict', 'reason', 'quality']) {
      expect(prompt).toContain(field)
    }
  })

  it('truncates long README input', () => {
    const prompt = buildEnrichmentPrompt(repo, 'x'.repeat(9000))
    expect(prompt.length).toBeLessThan(9000)
    expect(prompt).toContain('x'.repeat(8000))
    expect(prompt).not.toContain('x'.repeat(8001))
  })

  it('keeps explicit versions for evaluation and report provenance', () => {
    expect(PROMPT_VERSIONS.enrich).toBe('enrich@1')
    expect(SCORING_VERSION).toBe('score@1')
  })
})
