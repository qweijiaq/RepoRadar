/**
 * 从常见 lockfile 提取已安装版本。解析失败时返回空表，不影响主流程。
 */
export function parseLockfileVersions(name: string, content: string): Map<string, string> {
  const lower = name.toLowerCase()
  if (lower === 'package-lock.json') return parsePackageLock(content)
  if (lower === 'pnpm-lock.yaml') return parsePnpmLock(content)
  if (lower === 'yarn.lock') return parseYarnLock(content)
  if (lower === 'poetry.lock' || lower === 'uv.lock') return parsePoetryLock(content)
  if (lower === 'go.sum') return parseGoSum(content)
  if (lower === 'cargo.lock') return parseCargoLock(content)
  return new Map()
}

function add(map: Map<string, string>, name: string, version: string | undefined): void {
  const cleanName = name.trim().replace(/^\/+/, '')
  const cleanVersion = version?.trim()
  if (!cleanName || !cleanVersion) return
  if (!map.has(cleanName)) map.set(cleanName, cleanVersion)
}

function parsePackageLock(content: string): Map<string, string> {
  const versions = new Map<string, string>()
  try {
    const data = JSON.parse(content) as {
      packages?: Record<string, { version?: string }>
      dependencies?: Record<string, { version?: string; dependencies?: unknown }>
    }
    for (const [path, entry] of Object.entries(data.packages ?? {})) {
      const match = path.match(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)$/)
      if (match?.[1]) add(versions, match[1], entry.version)
    }
    const walk = (deps: Record<string, { version?: string; dependencies?: unknown }> | undefined) => {
      for (const [depName, entry] of Object.entries(deps ?? {})) {
        add(versions, depName, entry.version)
        if (entry.dependencies && typeof entry.dependencies === 'object') {
          walk(entry.dependencies as Record<string, { version?: string; dependencies?: unknown }>)
        }
      }
    }
    walk(data.dependencies)
  } catch {
    // lockfile 损坏时忽略
  }
  return versions
}

function parsePnpmLock(content: string): Map<string, string> {
  const versions = new Map<string, string>()
  for (const line of content.split('\n')) {
    const match = line.match(/^\s{2}['"]?\/?((?:@[^/\s]+\/)?[^@\s:'"]+)@([^():\s'"]+)/)
    if (match?.[1] && match[2] && /^\d/.test(match[2])) add(versions, match[1], match[2])
  }
  return versions
}

function parseYarnLock(content: string): Map<string, string> {
  const versions = new Map<string, string>()
  let current: string | null = null
  for (const line of content.split('\n')) {
    if (!line.startsWith(' ') && line.trim().endsWith(':')) {
      const key = line.trim().replace(/:$/, '').replace(/^"|"$/g, '')
      const first = key.split(',')[0]?.trim() ?? ''
      const match = first.match(/^((?:@[^/]+\/)?[^@]+)@/)
      current = match?.[1] ?? null
      continue
    }
    if (current) {
      const match = line.match(/^\s+version\s+"([^"]+)"/)
      if (match?.[1]) {
        add(versions, current, match[1])
        current = null
      }
    }
  }
  return versions
}

function parsePoetryLock(content: string): Map<string, string> {
  const versions = new Map<string, string>()
  let name: string | null = null
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '[[package]]') {
      name = null
      continue
    }
    const nameMatch = trimmed.match(/^name\s*=\s*"([^"]+)"/)
    if (nameMatch?.[1]) name = nameMatch[1]
    const versionMatch = trimmed.match(/^version\s*=\s*"([^"]+)"/)
    if (name && versionMatch?.[1]) {
      add(versions, name, versionMatch[1])
      name = null
    }
  }
  return versions
}

function parseGoSum(content: string): Map<string, string> {
  const versions = new Map<string, string>()
  for (const line of content.split('\n')) {
    const match = line.match(/^(\S+)\s+v([^\s]+)\s+(?:h1|go\.mod)/)
    if (match?.[1] && match[2]) add(versions, match[1], match[2])
  }
  return versions
}

function parseCargoLock(content: string): Map<string, string> {
  const versions = new Map<string, string>()
  let name: string | null = null
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '[[package]]') {
      name = null
      continue
    }
    const nameMatch = trimmed.match(/^name\s*=\s*"([^"]+)"/)
    if (nameMatch?.[1]) name = nameMatch[1]
    const versionMatch = trimmed.match(/^version\s*=\s*"([^"]+)"/)
    if (name && versionMatch?.[1]) {
      add(versions, name, versionMatch[1])
      name = null
    }
  }
  return versions
}
