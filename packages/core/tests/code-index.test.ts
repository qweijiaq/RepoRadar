import { afterEach, describe, expect, it, vi } from 'vitest'
import { entryPointsFromManifest, splitCodeChunks } from '../src/code-index.js'

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

describe('entryPointsFromManifest', () => {
  it('collects main/module/exports/bin paths', () => {
    const manifest = JSON.stringify({
      main: 'dist/index.js',
      module: './esm/index.js',
      exports: {
        '.': { import: './src/index.ts', types: './src/index.d.ts' },
        './server': './src/server.ts',
      },
      bin: { radar: './bin/cli.js' },
    })
    const entries = entryPointsFromManifest(manifest)
    expect(entries).toEqual(
      expect.arrayContaining(['dist/index.js', 'esm/index.js', 'src/index.ts', 'src/server.ts', 'bin/cli.js']),
    )
  })

  it('returns an empty list for invalid manifests', () => {
    expect(entryPointsFromManifest(null)).toEqual([])
    expect(entryPointsFromManifest('not json')).toEqual([])
    expect(entryPointsFromManifest('{"main":"https://cdn.example.com/x.js"}')).toEqual([])
  })
})
