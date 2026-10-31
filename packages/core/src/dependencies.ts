/**
 * 从常见依赖清单里提取依赖名，用于判断候选是否已经在使用。
 */
export function extractDependencies(manifestName: string, manifest: string): string[] {
  const name = manifestName.toLowerCase()

  if (name === 'package.json') {
    try {
      const data = JSON.parse(manifest) as {
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
        peerDependencies?: Record<string, string>
      }
      return [
        ...new Set([
          ...Object.keys(data.dependencies ?? {}),
          ...Object.keys(data.devDependencies ?? {}),
          ...Object.keys(data.peerDependencies ?? {}),
        ]),
      ]
    } catch {
      return []
    }
  }

  if (name === 'requirements.txt') {
    return manifest
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => (line.split(/[=<>!~[ ]/)[0] ?? '').trim())
      .filter(Boolean)
  }

  if (name === 'go.mod') {
    return [...manifest.matchAll(/^\s*([\w./-]+)\s+v[\w.+-]+/gm)].map((match) => match[1] ?? '').filter(Boolean)
  }

  if (name === 'cargo.toml') {
    const dependencies: string[] = []
    let inDependencies = false
    for (const rawLine of manifest.split('\n')) {
      const line = rawLine.trim()
      if (line.startsWith('[')) {
        inDependencies = line === '[dependencies]' || line === '[dev-dependencies]'
        const tableMatch = line.match(/^\[(?:dev-)?dependencies\.([A-Za-z0-9_-]+)\]$/)
        if (tableMatch?.[1]) dependencies.push(tableMatch[1])
        continue
      }
      if (!inDependencies || !line || line.startsWith('#')) continue
      const match = line.match(/^([A-Za-z0-9_-]+)\s*=/)
      if (match?.[1]) dependencies.push(match[1])
    }
    return [...new Set(dependencies)]
  }

  if (name === 'pyproject.toml') {
    const dependencies: string[] = []
    const block = manifest.match(/dependencies\s*=\s*\[([\s\S]*?)\]/)
    if (block?.[1]) {
      for (const match of block[1].matchAll(/["']([A-Za-z0-9_.-]+)/g)) {
        if (match[1]) dependencies.push(match[1])
      }
    }
    return [...new Set(dependencies)]
  }

  return []
}

export type DependencyEcosystem = 'npm' | 'pypi' | 'go' | 'cargo'

export interface DependencySpec {
  name: string
  declared: string | null
  ecosystem: DependencyEcosystem
  dev: boolean
}

/**
 * 解析直接依赖及其声明版本。只覆盖能查询注册表的 npm / PyPI。
 */
export function parseDependencySpecs(manifestName: string, manifest: string): DependencySpec[] {
  const name = manifestName.toLowerCase()

  if (name === 'package.json') {
    try {
      const data = JSON.parse(manifest) as {
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
        peerDependencies?: Record<string, string>
      }
      const specs: DependencySpec[] = []
      for (const [dep, version] of Object.entries(data.dependencies ?? {})) {
        specs.push({ name: dep, declared: version, ecosystem: 'npm', dev: false })
      }
      for (const [dep, version] of Object.entries(data.devDependencies ?? {})) {
        specs.push({ name: dep, declared: version, ecosystem: 'npm', dev: true })
      }
      for (const [dep, version] of Object.entries(data.peerDependencies ?? {})) {
        specs.push({ name: dep, declared: version, ecosystem: 'npm', dev: false })
      }
      return specs
    } catch {
      return []
    }
  }

  if (name === 'requirements.txt') {
    const specs: DependencySpec[] = []
    for (const line of manifest.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-')) continue
      const match = trimmed.match(/^([A-Za-z0-9_.-]+)(?:\[[^\]]*\])?\s*(.*)$/)
      if (!match?.[1]) continue
      const spec = match[2]?.trim() ?? ''
      specs.push({
        name: match[1],
        declared: spec.match(/[<>=!~].*/)?.[0] ?? null,
        ecosystem: 'pypi',
        dev: false,
      })
    }
    return specs
  }

  if (name === 'go.mod') {
    const specs: DependencySpec[] = []
    for (const line of manifest.split('\n')) {
      const match = line.match(/^\s*([^\s/]+\/[^\s]+)\s+v([\w.+-]+)/)
      if (match?.[1] && match[2]) {
        specs.push({ name: match[1], declared: `v${match[2]}`, ecosystem: 'go', dev: false })
      }
    }
    return specs
  }

  if (name === 'cargo.toml') {
    const specs: DependencySpec[] = []
    let inDependencies = false
    for (const rawLine of manifest.split('\n')) {
      const line = rawLine.trim()
      if (line.startsWith('[')) {
        inDependencies = line === '[dependencies]' || line === '[dev-dependencies]'
        continue
      }
      if (!inDependencies || !line || line.startsWith('#')) continue
      const match = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(?:\{[^}]*version\s*=\s*["']([^"']+)["']|["']([^"']+)["'])/)
      if (match?.[1]) {
        specs.push({ name: match[1], declared: match[2] ?? match[3] ?? null, ecosystem: 'cargo', dev: false })
      }
    }
    return specs
  }

  if (name === 'pyproject.toml') {
    const specs: DependencySpec[] = []
    const block = manifest.match(/dependencies\s*=\s*\[([\s\S]*?)\]/)
    if (block?.[1]) {
      for (const match of block[1].matchAll(/["']([A-Za-z0-9_.-]+)([^"']*)["']/g)) {
        if (match[1]) {
          specs.push({
            name: match[1],
            declared: match[2]?.match(/[<>=!~].*/)?.[0]?.trim() ?? null,
            ecosystem: 'pypi',
            dev: false,
          })
        }
      }
    }
    return specs
  }

  return []
}

