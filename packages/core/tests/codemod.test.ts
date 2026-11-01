import { describe, expect, it } from 'vitest'
import {
  buildFilePatch,
  buildMechanicalSwapPatch,
  rewriteModuleSpecifiers,
  swapDependencyInJson,
} from '../src/codemod.js'

const source = [
  "import axios from 'axios'",
  "import { get } from 'axios/lib'",
  "export { post } from 'axios'",
  "const legacy = require('axios')",
  '',
].join('\n')

describe('rewriteModuleSpecifiers', () => {
  it('rewrites imports, subpaths, re-exports and require calls', () => {
    const result = rewriteModuleSpecifiers(source, 'axios', 'ofetch', 'src/http.ts')
    expect(result.rewrites).toBe(4)
    expect(result.code).toContain("from 'ofetch'")
    expect(result.code).toContain("from 'ofetch/lib'")
    expect(result.code).toContain("require('ofetch')")
    expect(result.code).not.toContain("'axios'")
  })

  it('leaves unrelated modules untouched', () => {
    const result = rewriteModuleSpecifiers(source, 'ky', 'ofetch', 'src/http.ts')
    expect(result.changed).toBe(false)
    expect(result.rewrites).toBe(0)
    expect(result.code).toBe(source)
  })

  it('skips non-script files', () => {
    const result = rewriteModuleSpecifiers('axios\n', 'axios', 'ofetch', 'README.md')
    expect(result.changed).toBe(false)
  })
})

describe('buildFilePatch', () => {
  it('returns a git-appliable patch', () => {
    const patch = buildFilePatch('src/a.ts', 'const a = 1\n', 'const a = 2\n')
    expect(patch).toContain('diff --git a/src/a.ts b/src/a.ts')
    expect(patch).toContain('--- a/src/a.ts')
    expect(patch).toContain('+++ b/src/a.ts')
    expect(patch).toContain('-const a = 1')
    expect(patch).toContain('+const a = 2')
  })
})

describe('swapDependencyInJson', () => {
  it('renames the dependency key and marks it latest', () => {
    const manifest = '{\n  "dependencies": {\n    "axios": "^1.0.0"\n  }\n}\n'
    const next = swapDependencyInJson(manifest, 'axios', 'ofetch')
    expect(next).toContain('"ofetch": "latest"')
    expect(next).not.toContain('"axios"')
  })

  it('returns null when the old dependency or new dependency is absent/present', () => {
    expect(swapDependencyInJson('{}', 'axios', 'ofetch')).toBeNull()
    const both = '{"dependencies":{"axios":"1","ofetch":"2"}}'
    expect(swapDependencyInJson(both, 'axios', 'ofetch')).toBeNull()
  })
})

describe('buildMechanicalSwapPatch', () => {
  it('combines the manifest and target-file patches', () => {
    const result = buildMechanicalSwapPatch({
      manifestName: 'package.json',
      manifest: '{\n  "dependencies": {\n    "axios": "^1.0.0"\n  }\n}\n',
      targetFile: { path: 'src/http.ts', content: source },
      fromPackage: 'axios',
      toPackage: 'ofetch',
    })
    expect(result?.files).toEqual(['package.json', 'src/http.ts'])
    expect(result?.patch).toContain('diff --git a/package.json')
    expect(result?.patch).toContain('diff --git a/src/http.ts')
    expect(result?.summary).toContain('机械换库')
  })

  it('returns null when nothing can be rewritten', () => {
    expect(
      buildMechanicalSwapPatch({
        manifestName: 'package.json',
        manifest: '{"dependencies":{}}',
        targetFile: { path: 'src/http.ts', content: 'export const a = 1\n' },
        fromPackage: 'axios',
        toPackage: 'ofetch',
      }),
    ).toBeNull()
  })
})
