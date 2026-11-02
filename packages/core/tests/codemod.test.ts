import { describe, expect, it } from 'vitest'
import {
  buildFilePatch,
  buildMechanicalSwapPatch,
  rewriteModuleSpecifiers,
  swapDependencyInJson,
  swapDependencyInManifest,
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

describe('rewriteModuleSpecifiers across languages', () => {
  it('rewrites python imports', () => {
    const source = 'import old\nimport os, old as alias\nfrom old.sub import thing\n'
    const result = rewriteModuleSpecifiers(source, 'old', 'next', 'src/app.py')
    expect(result.rewrites).toBe(3)
    expect(result.code).toContain('import next')
    expect(result.code).toContain('import os, next as alias')
    expect(result.code).toContain('from next.sub import thing')
  })

  it('rewrites go import paths', () => {
    const source = 'import (\n  "github.com/old/pkg"\n  "fmt"\n)\n'
    const result = rewriteModuleSpecifiers(source, 'github.com/old/pkg', 'github.com/new/pkg', 'main.go')
    expect(result.rewrites).toBe(1)
    expect(result.code).toContain('"github.com/new/pkg"')
    expect(result.code).toContain('"fmt"')
  })

  it('rewrites rust use and extern crate', () => {
    const source = 'use old::thing;\nextern crate old;\nuse std::fmt;\n'
    const result = rewriteModuleSpecifiers(source, 'old', 'next', 'src/lib.rs')
    expect(result.rewrites).toBe(2)
    expect(result.code).toContain('use next::thing;')
    expect(result.code).toContain('extern crate next;')
    expect(result.code).toContain('use std::fmt;')
  })

  it('returns unchanged for unsupported files', () => {
    const result = rewriteModuleSpecifiers('old\n', 'old', 'next', 'README.md')
    expect(result.changed).toBe(false)
  })
})

describe('swapDependencyInManifest', () => {
  it('handles requirements, pyproject, go.mod and Cargo.toml', () => {
    expect(swapDependencyInManifest('requirements.txt', 'old>=1.0\nother==2\n', 'old', 'next')).toBe(
      'next>=1.0\nother==2\n',
    )
    expect(
      swapDependencyInManifest('pyproject.toml', 'dependencies = ["old>=1.0", "other"]\n', 'old', 'next'),
    ).toContain('"next>=1.0"')
    expect(
      swapDependencyInManifest('go.mod', 'require github.com/old/pkg v1.2.3\n', 'github.com/old/pkg', 'github.com/new/pkg'),
    ).toContain('github.com/new/pkg')
    expect(swapDependencyInManifest('Cargo.toml', '[dependencies]\nold = "1.0"\n', 'old', 'next')).toContain(
      'next = "1.0"',
    )
  })

  it('returns null for unknown manifests or missing dependencies', () => {
    expect(swapDependencyInManifest('composer.json', '{}', 'old', 'next')).toBeNull()
    expect(swapDependencyInManifest('requirements.txt', 'other==1\n', 'old', 'next')).toBeNull()
    expect(swapDependencyInManifest(null, null, 'old', 'next')).toBeNull()
  })
})

describe('buildMechanicalSwapPatch for python', () => {
  it('combines requirements and a python source file', () => {
    const result = buildMechanicalSwapPatch({
      manifestName: 'requirements.txt',
      manifest: 'old>=1.0\n',
      targetFile: { path: 'app/main.py', content: 'from old import client\n' },
      fromPackage: 'old',
      toPackage: 'next',
    })
    expect(result?.files).toEqual(['requirements.txt', 'app/main.py'])
    expect(result?.patch).toContain('diff --git a/requirements.txt')
    expect(result?.patch).toContain('+next>=1.0')
    expect(result?.patch).toContain('+from next import client')
  })
})
