import { describe, expect, it } from 'vitest'
import { parseDependencySpecs } from '../src/dependencies.js'
import {
  compareVersions,
  isOutdated,
  parseGitHubRepository,
  versionParts,
  versionRisk,
} from '../src/registry.js'

describe('registry helpers', () => {
  it('parses GitHub repository URLs', () => {
    expect(parseGitHubRepository('git+https://github.com/vercel/next.js.git')).toBe('vercel/next.js')
    expect(parseGitHubRepository('https://github.com/owner/repo')).toBe('owner/repo')
    expect(parseGitHubRepository('https://gitlab.com/owner/repo')).toBeNull()
  })

  it('compares versions', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0)
    expect(versionParts('^1.2.3')).toEqual([1, 2, 3])
    expect(isOutdated('^1.2.3', '1.3.0')).toBe(true)
    expect(isOutdated('^1.2.3', '1.2.3')).toBe(false)
  })

  it('classifies upgrade risk', () => {
    expect(versionRisk('^1.2.3', '2.0.0')).toBe('major')
    expect(versionRisk('^1.2.3', '1.3.0')).toBe('minor')
    expect(versionRisk('1.2.3', '1.2.4')).toBe('patch')
    expect(versionRisk('^0.1.0', '0.2.0')).toBe('major')
    expect(versionRisk(null, '1.0.0')).toBe('unknown')
  })
})

describe('parseDependencySpecs', () => {
  it('reads npm dependencies with versions and dev flags', () => {
    const specs = parseDependencySpecs(
      'package.json',
      JSON.stringify({
        dependencies: { next: '^15.0.0' },
        devDependencies: { vitest: '^3.0.0' },
      }),
    )
    expect(specs).toEqual([
      { name: 'next', declared: '^15.0.0', ecosystem: 'npm', dev: false },
      { name: 'vitest', declared: '^3.0.0', ecosystem: 'npm', dev: true },
    ])
  })

  it('reads go and cargo dependencies with versions', () => {
    expect(
      parseDependencySpecs(
        'go.mod',
        'module example.com/app\n\nrequire (\n  github.com/gin-gonic/gin v1.10.0\n)\n',
      ),
    ).toEqual([
      { name: 'github.com/gin-gonic/gin', declared: 'v1.10.0', ecosystem: 'go', dev: false },
    ])
    expect(
      parseDependencySpecs('Cargo.toml', '[dependencies]\nserde = "1.0"\ntokio = { version = "1.2", features = ["full"] }\n'),
    ).toEqual([
      { name: 'serde', declared: '1.0', ecosystem: 'cargo', dev: false },
      { name: 'tokio', declared: '1.2', ecosystem: 'cargo', dev: false },
    ])
  })

  it('reads requirements without options', () => {
    const specs = parseDependencySpecs(
      'requirements.txt',
      '# base\nfastapi>=0.115\nuvicorn[standard]==0.30\n-r other.txt\n',
    )
    expect(specs).toEqual([
      { name: 'fastapi', declared: '>=0.115', ecosystem: 'pypi', dev: false },
      { name: 'uvicorn', declared: '==0.30', ecosystem: 'pypi', dev: false },
    ])
  })
})
