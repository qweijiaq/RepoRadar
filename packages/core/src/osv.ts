export interface OsvVulnerability {
  id: string
  summary: string | null
  severity: string | null
}

interface OsvResponse {
  vulns?: Array<{
    id?: string
    summary?: string
    database_specific?: { severity?: string }
    severity?: Array<{ type?: string; score?: string }>
  }>
}

const cache = new Map<string, { expires: number; value: OsvVulnerability[] }>()
const CACHE_TTL = 6 * 60 * 60 * 1000

function ecosystemName(ecosystem: 'npm' | 'pypi' | 'go' | 'cargo'): string {
  if (ecosystem === 'npm') return 'npm'
  if (ecosystem === 'pypi') return 'PyPI'
  if (ecosystem === 'go') return 'Go'
  return 'crates.io'
}

/**
 * 查询 OSV 安全公告。失败时返回空列表，不阻塞依赖报告。
 */
export async function queryOsv(
  name: string,
  version: string | null,
  ecosystem: 'npm' | 'pypi' | 'go' | 'cargo',
): Promise<OsvVulnerability[]> {
  if (!version) return []
  const key = `${ecosystem}:${name}:${version}`
  const cached = cache.get(key)
  if (cached && cached.expires > Date.now()) return cached.value

  try {
    const response = await fetch('https://api.osv.dev/v1/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        package: { name, ecosystem: ecosystemName(ecosystem) },
        version: ecosystem === 'go' ? version.replace(/^v/, '') : version,
      }),
      signal: AbortSignal.timeout(6000),
    })
    if (!response.ok) return []
    const data = (await response.json()) as OsvResponse
    const value: OsvVulnerability[] = (data.vulns ?? []).map((vuln) => ({
      id: vuln.id ?? 'OSV',
      summary: vuln.summary?.slice(0, 200) ?? null,
      severity:
        vuln.database_specific?.severity ??
        vuln.severity?.find((entry) => entry.type === 'CVSS_V3')?.score ??
        null,
    }))
    cache.set(key, { value, expires: Date.now() + CACHE_TTL })
    return value
  } catch {
    return []
  }
}
