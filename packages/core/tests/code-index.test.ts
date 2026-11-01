import { afterEach, describe, expect, it, vi } from 'vitest'
import { entryPointsFromManifest, splitCodeBySymbol, splitCodeChunks } from '../src/code-index.js'

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

describe('splitCodeBySymbol', () => {
  it('splits TypeScript by exported symbols and keeps the preamble', () => {
    const source = [
      "import { z } from 'zod'",
      '',
      'export function alpha(input: string) {',
      '  return input.trim()',
      '}',
      '',
      'export class Beta {',
      '  run() { return 1 }',
      '}',
      '',
      'export const gamma = () => 42',
    ].join('\n')

    const parts = splitCodeBySymbol(source)
    const symbols = parts.map((part) => part.symbol)
    expect(symbols).toEqual(expect.arrayContaining(['alpha', 'Beta', 'gamma']))
    expect(parts.some((part) => part.symbol === null && part.content.includes('import'))).toBe(true)
    expect(parts.find((part) => part.symbol === 'alpha')?.content).toContain('input.trim()')
  })

  it('detects python, go and rust functions', () => {
    expect(splitCodeBySymbol('def main():\n    return 1\n').map((part) => part.symbol)).toContain('main')
    expect(splitCodeBySymbol('func Run(x int) int {\n  return x\n}\n').map((part) => part.symbol)).toContain('Run')
    expect(splitCodeBySymbol('pub fn run() {\n}\n').map((part) => part.symbol)).toContain('run')
  })

  it('falls back to fixed chunks when no symbol is found', () => {
    const text = Array.from({ length: 200 }, (_, index) => `line ${index} ${'y'.repeat(30)}`).join('\n')
    const parts = splitCodeBySymbol(text, 500)
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.every((part) => part.symbol === null)).toBe(true)
  })
})
