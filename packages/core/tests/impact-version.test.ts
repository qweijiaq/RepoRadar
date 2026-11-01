import { describe, expect, it } from 'vitest'
import { resolveInstalledVersion } from '../src/integration-impacts.js'
import type { IntegrationProjectInput } from '../src/integrations.js'

function context(lockfileName: string | null, lockfile: string | null): IntegrationProjectInput {
  return {
    repo: 'me/app',
    description: '',
    language: 'TypeScript',
    topics: [],
    dependencies: [],
    readme: null,
    manifestName: 'package.json',
    manifest: '{}',
    lockfileName,
    lockfile,
  }
}

describe('resolveInstalledVersion', () => {
  it('reads the installed version from package-lock.json', () => {
    const lockfile = JSON.stringify({
      packages: {
        'node_modules/zod': { version: '3.23.8' },
      },
    })
    expect(resolveInstalledVersion(context('package-lock.json', lockfile), 'zod')).toBe('3.23.8')
  })

  it('reads scoped packages from pnpm-lock.yaml', () => {
    const lockfile = ['lockfileVersion: 9', "  /@scope/pkg@1.2.3:", '    resolution: {integrity: sha512-x}'].join('\n')
    expect(resolveInstalledVersion(context('pnpm-lock.yaml', lockfile), '@scope/pkg')).toBe('1.2.3')
  })

  it('returns null when there is no lockfile or package', () => {
    expect(resolveInstalledVersion(null, 'zod')).toBeNull()
    expect(resolveInstalledVersion(context(null, null), 'zod')).toBeNull()
    expect(resolveInstalledVersion(context('package-lock.json', '{}'), 'zod')).toBeNull()
  })
})
