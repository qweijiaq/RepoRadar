import { describe, expect, it } from 'vitest'
import { splitWithTreeSitter } from '../src/code-symbols.js'

describe('splitWithTreeSitter', () => {
  it('extracts top-level TypeScript symbols', async () => {
    const parts = await splitWithTreeSitter(
      'src/a.ts',
      [
        "import { z } from 'zod'",
        '',
        'export function hello(name: string) {',
        '  return name',
        '}',
        '',
        'export class Foo {',
        '  run() { return 1 }',
        '}',
        '',
        'export const bar = () => 42',
      ].join('\n'),
    )
    expect(parts).not.toBeNull()
    const symbols = (parts ?? []).map((part) => part.symbol)
    expect(symbols).toEqual(expect.arrayContaining(['hello', 'Foo', 'bar']))
    expect(parts?.[0]?.symbol).toBeNull()
  })

  it('returns null for unsupported extensions', async () => {
    expect(await splitWithTreeSitter('README.md', '# hi')).toBeNull()
  })
})
