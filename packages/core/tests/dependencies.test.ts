import { describe, expect, it } from 'vitest'
import { extractDependencies } from '../src/dependencies.js'

describe('extractDependencies', () => {
  it('reads package.json runtime and dev dependencies', () => {
    const dependencies = extractDependencies(
      'package.json',
      JSON.stringify({
        dependencies: { next: '15.0.0', zod: '^3.0.0' },
        devDependencies: { vitest: '^3.0.0' },
        peerDependencies: { react: '^19.0.0' },
      }),
    )
    expect(dependencies).toEqual(['next', 'zod', 'vitest', 'react'])
  })

  it('returns an empty list for malformed package.json', () => {
    expect(extractDependencies('package.json', '{oops')).toEqual([])
  })

  it('reads requirements.txt and skips comments and version specifiers', () => {
    const dependencies = extractDependencies(
      'requirements.txt',
      '# comment\nfastapi>=0.115\nuvicorn[standard]==0.30\n\n',
    )
    expect(dependencies).toEqual(['fastapi', 'uvicorn'])
  })

  it('reads go.mod require lines', () => {
    const dependencies = extractDependencies(
      'go.mod',
      'module example.com/app\n\ngo 1.22\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.10.0\n)\n',
    )
    expect(dependencies).toEqual(['github.com/gin-gonic/gin'])
  })

  it('reads cargo dependencies in table and inline forms', () => {
    const dependencies = extractDependencies(
      'Cargo.toml',
      '[dependencies]\nserde = "1"\n\n[dependencies.tokio]\nversion = "1"\n\n[dev-dependencies]\nproptest = "1"\n',
    )
    expect(dependencies).toEqual(['serde', 'tokio', 'proptest'])
  })

  it('reads PEP 621 project dependencies', () => {
    const dependencies = extractDependencies(
      'pyproject.toml',
      '[project]\nname = "app"\ndependencies = [\n  "httpx>=0.27",\n  "pydantic",\n]\n',
    )
    expect(dependencies).toEqual(['httpx', 'pydantic'])
  })

  it('ignores unknown manifests', () => {
    expect(extractDependencies('Gemfile', 'gem "rails"')).toEqual([])
  })
})
