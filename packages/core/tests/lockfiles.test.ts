import { describe, expect, it } from 'vitest'
import { parseLockfileVersions } from '../src/lockfiles.js'

describe('parseLockfileVersions', () => {
  it('reads package-lock packages and nested dependencies', () => {
    const versions = parseLockfileVersions(
      'package-lock.json',
      JSON.stringify({
        packages: {
          '': { version: '1.0.0' },
          'node_modules/next': { version: '15.2.0' },
          'node_modules/@scope/pkg': { version: '2.3.4' },
        },
        dependencies: {
          legacy: { version: '1.2.3', dependencies: { child: { version: '0.4.0' } } },
        },
      }),
    )
    expect(versions.get('next')).toBe('15.2.0')
    expect(versions.get('@scope/pkg')).toBe('2.3.4')
    expect(versions.get('legacy')).toBe('1.2.3')
    expect(versions.get('child')).toBe('0.4.0')
  })

  it('reads pnpm lock package keys', () => {
    const versions = parseLockfileVersions(
      'pnpm-lock.yaml',
      `lockfileVersion: '9.0'\npackages:\n  next@15.2.0:\n    resolution: {integrity: sha512}\n  '@scope/pkg@2.3.4':\n    resolution: {integrity: sha512}\n`,
    )
    expect(versions.get('next')).toBe('15.2.0')
    expect(versions.get('@scope/pkg')).toBe('2.3.4')
  })

  it('reads yarn lock version blocks', () => {
    const versions = parseLockfileVersions(
      'yarn.lock',
      `"next@^15.0.0":\n  version "15.2.0"\n\n"@scope/pkg@^2.0.0":\n  version "2.3.4"\n`,
    )
    expect(versions.get('next')).toBe('15.2.0')
    expect(versions.get('@scope/pkg')).toBe('2.3.4')
  })

  it('reads poetry, go and cargo lockfiles', () => {
    expect(
      parseLockfileVersions(
        'poetry.lock',
        '[[package]]\nname = "fastapi"\nversion = "0.115.0"\n',
      ).get('fastapi'),
    ).toBe('0.115.0')
    expect(
      parseLockfileVersions('go.sum', 'github.com/gin-gonic/gin v1.10.0 h1:abc\n').get(
        'github.com/gin-gonic/gin',
      ),
    ).toBe('1.10.0')
    expect(
      parseLockfileVersions('Cargo.lock', '[[package]]\nname = "serde"\nversion = "1.0.200"\n').get(
        'serde',
      ),
    ).toBe('1.0.200')
  })

  it('ignores unknown or malformed files', () => {
    expect(parseLockfileVersions('package-lock.json', '{oops').size).toBe(0)
    expect(parseLockfileVersions('Gemfile.lock', 'rails (7.0.0)').size).toBe(0)
  })
})
