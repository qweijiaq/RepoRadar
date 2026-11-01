import { afterEach, describe, expect, it, vi } from 'vitest'
import { splitCodeChunks } from '../src/code-index.js'

describe('splitCodeChunks', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keeps short content as a single chunk', () => {
    expect(splitCodeChunks('export const a = 1')).toEqual(['export const a = 1'])
    expect(splitCodeChunks('   ')).toEqual([])
  })

  it('splits long content with overlap', () => {
    const body = Array.from({ length: 120 }, (_, index) => `line ${index} ${'x'.repeat(40)}`).join('\n')
    const chunks = splitCodeChunks(body, 800, 100)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) => chunk.length <= 800)).toBe(true)
    expect(chunks.join('')).toContain('line 119')
  })
})
