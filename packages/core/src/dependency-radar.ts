import { parseDependencySpecs } from './dependencies.js'
import { isOutdated, lookupPackages, versionParts, versionRisk, type PackageEcosystem, type VersionRisk } from './registry.js'
import { parseLockfileVersions } from './lockfiles.js'
import { queryOsv, type OsvVulnerability } from './osv.js'

export interface DependencyCheck {
  name: string
  ecosystem: PackageEcosystem
  dev: boolean
  declared: string | null
  installed: string | null
  latest: string | null
  repo: string | null
  outdated: boolean
  risk: VersionRisk
  deprecated: boolean
  releaseNotes: string | null
  releaseUrl: string | null
  vulnerabilities: OsvVulnerability[]
}

export interface DependencyCheckResult {
  supported: boolean
  items: DependencyCheck[]
  note: string | null
}

function apiBase(): string {
  return (process.env.GITHUB_API_BASE?.trim() || 'https://api.github.com').replace(/\/+$/, '')
}

async function latestRelease(
  token: string | null,
  repo: string,
): Promise<{ body: string | null; url: string | null }> {
  try {
    const response = await fetch(`${apiBase()}/repos/${repo}/releases/latest`, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'repo-radar',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(6000),
      cache: 'no-store',
    } as RequestInit & { cache: 'no-store' })
    if (!response.ok) return { body: null, url: null }
    const data = (await response.json()) as { body?: string | null; html_url?: string | null }
    return { body: data.body?.slice(0, 1800) ?? null, url: data.html_url ?? null }
  } catch {
    return { body: null, url: null }
  }
}

/**
 * 查询项目直接依赖的最新版本。版本按声明范围估算，lockfile 精确版本后续再接入。
 */
export async function checkProjectDependencies(
  manifestName: string | null,
  manifest: string | null,
  options: {
    token?: string | null
    limit?: number
    includeDev?: boolean
    lockfile?: { name: string; content: string } | null
  } = {},
): Promise<DependencyCheckResult> {
  if (!manifestName || !manifest) {
    return { supported: false, items: [], note: '没有读取到依赖清单。' }
  }

  const specs = parseDependencySpecs(manifestName, manifest)
  if (specs.length === 0) {
    return {
      supported: false,
      items: [],
      note: '当前只自动检查 npm（package.json）和 PyPI（requirements.txt / pyproject.toml）依赖。',
    }
  }

  const unique = new Map<string, (typeof specs)[number]>()
  for (const spec of specs) {
    if (!options.includeDev && spec.dev) continue
    unique.set(`${spec.ecosystem}:${spec.name}`, spec)
  }
  const selected = [...unique.values()].slice(0, options.limit ?? 12)
  const packages = await lookupPackages(
    selected.map((spec) => ({ name: spec.name, ecosystem: spec.ecosystem })),
    selected.length,
  )

  const installedVersions = options.lockfile
    ? parseLockfileVersions(options.lockfile.name, options.lockfile.content)
    : new Map<string, string>()
  const installedOf = (name: string): string | null =>
    installedVersions.get(name) ??
    installedVersions.get(name.toLowerCase()) ??
    installedVersions.get(name.replace(/_/g, '-')) ??
    null

  const items: DependencyCheck[] = selected.map((spec) => {
    const info = packages.get(`${spec.ecosystem}:${spec.name}`) ?? null
    const installed = installedOf(spec.name)
    const current = installed ?? spec.declared
    return {
      name: spec.name,
      ecosystem: spec.ecosystem,
      dev: spec.dev,
      declared: spec.declared,
      installed,
      latest: info?.latest ?? null,
      repo: info?.repository ?? null,
      outdated: isOutdated(current, info?.latest ?? null),
      risk: versionRisk(current, info?.latest ?? null),
      deprecated: info?.deprecated ?? false,
      releaseNotes: null,
      releaseUrl: null,
      vulnerabilities: [],
    }
  })

  await Promise.all(
    items.slice(0, 12).map(async (item) => {
      const version = item.installed ?? versionParts(item.declared)?.join('.') ?? null
      item.vulnerabilities = await queryOsv(item.name, version, item.ecosystem)
    }),
  )

  const risky = items
    .filter((item) => item.outdated && item.repo && item.risk !== 'patch')
    .sort((left, right) => (left.risk === 'major' ? -1 : 1) - (right.risk === 'major' ? -1 : 1))
    .slice(0, 3)

  for (const item of risky) {
    if (!item.repo) continue
    const release = await latestRelease(options.token ?? null, item.repo)
    item.releaseNotes = release.body
    item.releaseUrl = release.url
  }

  return {
    supported: true,
    items,
    note: options.lockfile
      ? `已读取 ${options.lockfile.name}，按实际安装版本估算。`
      : '版本按清单里的声明范围估算，未读取 lockfile；大版本升级前仍需确认实际安装版本。',
  }
}
