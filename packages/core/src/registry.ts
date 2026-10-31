export type PackageEcosystem = 'npm' | 'pypi' | 'go' | 'cargo'

export interface PackageInfo {
  name: string
  ecosystem: PackageEcosystem
  latest: string | null
  repository: string | null
  description: string | null
  deprecated: boolean
}

export type VersionRisk = 'major' | 'minor' | 'patch' | 'unknown'

const CACHE_TTL = 60 * 60 * 1000
const cache = new Map<string, { value: PackageInfo | null; expires: number }>()

export function parseGitHubRepository(value: string | null | undefined): string | null {
  if (!value) return null
  const match = value.match(/github\.com[/:]([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)/i)
  if (!match?.[1] || !match[2]) return null
  return `${match[1]}/${match[2].replace(/\.git$/i, '')}`
}

export function versionParts(version: string | null | undefined): [number, number, number] | null {
  if (!version) return null
  const match = version.match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/)
  if (!match?.[1]) return null
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)]
}

export function compareVersions(left: string | null, right: string | null): number {
  const a = versionParts(left)
  const b = versionParts(right)
  if (!a || !b) return 0
  for (let index = 0; index < 3; index++) {
    if (a[index]! !== b[index]!) return a[index]! - b[index]!
  }
  return 0
}

export function versionRisk(declared: string | null, latest: string | null): VersionRisk {
  const current = versionParts(declared)
  const next = versionParts(latest)
  if (!current || !next) return 'unknown'
  if (compareVersions(latest, declared) <= 0) return 'patch'
  if (next[0] !== current[0]) return 'major'
  // 0.x 版本里 minor 也可能破坏兼容
  if (current[0] === 0 && next[1] !== current[1]) return 'major'
  if (next[1] !== current[1]) return 'minor'
  return 'patch'
}

export function isOutdated(declared: string | null, latest: string | null): boolean {
  if (!declared || !latest) return false
  return compareVersions(latest, declared) > 0
}

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'repo-radar' },
      signal: AbortSignal.timeout(6000),
      cache: 'no-store',
    } as RequestInit & { cache: 'no-store' })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

async function lookupGo(name: string): Promise<PackageInfo | null> {
  const encoded = name.replace(/[A-Z]/g, (letter) => `!${letter.toLowerCase()}`)
  const data = (await fetchJson(`https://proxy.golang.org/${encoded}/@latest`)) as {
    Version?: string
  } | null
  if (!data) return null
  return {
    name,
    ecosystem: 'go',
    latest: data.Version?.replace(/^v/, '') ?? null,
    repository: name.startsWith('github.com/')
      ? parseGitHubRepository(`https://${name.split('/').slice(0, 3).join('/')}`)
      : null,
    description: null,
    deprecated: false,
  }
}

async function lookupCargo(name: string): Promise<PackageInfo | null> {
  const response = await fetch(`https://crates.io/api/v1/crates/${encodeURIComponent(name)}`, {
    headers: { accept: 'application/json', 'user-agent': 'repo-radar' },
    signal: AbortSignal.timeout(6000),
  }).catch(() => null)
  if (!response?.ok) return null
  const data = (await response.json()) as {
    crate?: { max_version?: string; description?: string; repository?: string; homepage?: string }
  } | null
  if (!data?.crate) return null
  return {
    name,
    ecosystem: 'cargo',
    latest: data.crate.max_version ?? null,
    repository: parseGitHubRepository(data.crate.repository ?? data.crate.homepage),
    description: data.crate.description?.slice(0, 300) ?? null,
    deprecated: false,
  }
}

async function lookupNpm(name: string): Promise<PackageInfo | null> {
  const data = (await fetchJson(`https://registry.npmjs.org/${name.replace('/', '%2F')}`)) as {
    'dist-tags'?: { latest?: string }
    repository?: string | { url?: string }
    description?: string
    versions?: Record<string, { deprecated?: string }>
  } | null
  if (!data) return null
  const latest = data['dist-tags']?.latest ?? null
  const repository = typeof data.repository === 'string' ? data.repository : data.repository?.url
  return {
    name,
    ecosystem: 'npm',
    latest,
    repository: parseGitHubRepository(repository),
    description: data.description?.slice(0, 300) ?? null,
    deprecated: Boolean(latest && data.versions?.[latest]?.deprecated),
  }
}

async function lookupPypi(name: string): Promise<PackageInfo | null> {
  const data = (await fetchJson(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`)) as {
    info?: {
      version?: string
      summary?: string
      home_page?: string
      project_urls?: Record<string, string>
    }
  } | null
  if (!data?.info) return null
  const urls = Object.values(data.info.project_urls ?? {})
  const repository =
    urls.map(parseGitHubRepository).find(Boolean) ?? parseGitHubRepository(data.info.home_page)
  return {
    name,
    ecosystem: 'pypi',
    latest: data.info.version ?? null,
    repository,
    description: data.info.summary?.slice(0, 300) ?? null,
    deprecated: false,
  }
}

export async function lookupPackage(
  name: string,
  ecosystem: PackageEcosystem,
): Promise<PackageInfo | null> {
  const key = `${ecosystem}:${name}`
  const cached = cache.get(key)
  if (cached && cached.expires > Date.now()) return cached.value

  const value =
    ecosystem === 'npm'
      ? await lookupNpm(name)
      : ecosystem === 'pypi'
        ? await lookupPypi(name)
        : ecosystem === 'go'
          ? await lookupGo(name)
          : await lookupCargo(name)
  cache.set(key, { value, expires: Date.now() + CACHE_TTL })
  return value
}

export async function lookupPackages(
  packages: Array<{ name: string; ecosystem: PackageEcosystem }>,
  limit = 12,
): Promise<Map<string, PackageInfo | null>> {
  const result = new Map<string, PackageInfo | null>()
  const queue = packages.slice(0, limit)
  let index = 0

  async function worker(): Promise<void> {
    while (index < queue.length) {
      const current = queue[index++]!
      result.set(`${current.ecosystem}:${current.name}`, await lookupPackage(current.name, current.ecosystem))
    }
  }

  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker))
  return result
}
