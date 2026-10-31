import { describe, expect, it } from 'vitest'
import { buildVerificationPlan, detectStack } from '../src/verify.js'

describe('detectStack', () => {
  it('detects common project types', () => {
    expect(detectStack(['package.json', 'src'])).toBe('node')
    expect(detectStack(['pyproject.toml'])).toBe('python')
    expect(detectStack(['requirements.txt'])).toBe('python')
    expect(detectStack(['go.mod'])).toBe('go')
    expect(detectStack(['Cargo.toml'])).toBe('rust')
    expect(detectStack(['index.html'])).toBe('unknown')
  })
})

describe('buildVerificationPlan', () => {
  it('uses npm ci with a lockfile and prefers the build script', () => {
    const plan = buildVerificationPlan(['package.json', 'package-lock.json'], {
      scripts: { build: 'tsc', test: 'vitest' },
    })
    expect(plan.image).toBe('node:22-alpine')
    expect(plan.commands).toEqual(['npm ci --no-audit --no-fund', 'npm run build'])
  })

  it('falls back to the test script when there is no build script', () => {
    const plan = buildVerificationPlan(['package.json'], { scripts: { test: 'vitest run' } })
    expect(plan.commands).toEqual(['npm install --no-audit --no-fund', 'npm run test'])
  })

  it('only installs when the package has no build or test script', () => {
    const plan = buildVerificationPlan(['package.json'], { scripts: {} })
    expect(plan.commands).toEqual(['npm install --no-audit --no-fund'])
  })

  it('plans python, go and rust projects', () => {
    expect(buildVerificationPlan(['pyproject.toml'], null).commands).toEqual(['pip install --user --no-cache-dir .'])
    expect(buildVerificationPlan(['requirements.txt'], null).commands).toEqual([
      'pip install --user --no-cache-dir -r requirements.txt',
    ])
    expect(buildVerificationPlan(['go.mod'], null).image).toBe('golang:1.23-alpine')
    expect(buildVerificationPlan(['Cargo.toml'], null).image).toBe('rust:1.83-alpine')
  })

  it('skips unknown stacks', () => {
    expect(buildVerificationPlan(['README.md'], null)).toEqual({ stack: 'unknown', image: null, commands: [] })
  })
})
