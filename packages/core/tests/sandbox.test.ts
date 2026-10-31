import { describe, expect, it } from 'vitest'
import { sandboxDockerArgs } from '../src/sandbox.js'

describe('sandboxDockerArgs', () => {
  const args = sandboxDockerArgs({ image: 'node:22-alpine', workDir: '/tmp/work', script: 'npm test' })

  it('drops capabilities and never gains new privileges', () => {
    expect(args).toContain('--cap-drop')
    expect(args[args.indexOf('--cap-drop') + 1]).toBe('ALL')
    expect(args).toContain('--security-opt')
    expect(args[args.indexOf('--security-opt') + 1]).toBe('no-new-privileges')
  })

  it('uses a read-only root filesystem and writable tmpfs caches', () => {
    expect(args).toContain('--read-only')
    expect(args).toContain('/tmp:rw,nosuid,nodev,size=1g')
    expect(args).toContain('npm_config_cache=/tmp/npm-cache')
    expect(args).toContain('HOME=/tmp')
  })

  it('runs as a numeric non-root user and mounts the workdir', () => {
    expect(args).toContain('--user')
    expect(args[args.indexOf('--user') + 1]).toMatch(/^\d+:\d+$/)
    expect(args).toContain('/tmp/work:/work')
    expect(args.at(-1)).toBe('npm test')
  })
})
