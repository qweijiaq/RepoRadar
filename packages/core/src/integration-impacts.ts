import type { DbPool } from './db.js'
import { fetchLatestRelease } from './github.js'
import { logEvent } from './logger.js'
import { queryOsv, queryOsvPackage } from './osv.js'
import { addNotification } from './notifications.js'
import { findRepoByFullName } from './db.js'
import type { IntegrationProjectInput } from './integrations.js'
import { parseLockfileVersions } from './lockfiles.js'
import { loadProjectContext } from './project-context.js'

export interface AdoptedIntegration {
  userId: number
  projectFullName: string
  suggestionRepo: string
  adoptedAt: string
}

export interface IntegrationImpact {
  id: number
  projectFullName: string
  suggestionRepo: string
  kind: 'release' | 'advisory'
  version: string
  title: string | null
  url: string | null
  publishedAt: string | null
  createdAt: string
}

interface AdoptedRow {
  user_id: string
  project_full_name: string
  suggestion_repo: string
  updated_at: Date | string
}

interface ImpactRow {
  id: string
  project_full_name: string
  suggestion_repo: string
  kind: string
  version: string
  title: string | null
  url: string | null
  published_at: Date | string | null
  created_at: Date | string
}

function iso(value: Date | string | null): string | null {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : value
}

/** 用户标记为「已接入」的项目与库。 */
export async function listAdoptedIntegrations(
  pool: DbPool,
  limit = 25,
): Promise<AdoptedIntegration[]> {
  const { rows } = await pool.query<AdoptedRow>(
    `SELECT user_id, project_full_name, suggestion_repo, updated_at
     FROM integration_outcomes
     WHERE status = 'adopted'
     ORDER BY updated_at ASC
     LIMIT $1`,
    [Math.max(1, Math.min(200, limit))],
  )
  return rows.map((row) => ({
    userId: Number(row.user_id),
    projectFullName: row.project_full_name,
    suggestionRepo: row.suggestion_repo,
    adoptedAt: iso(row.updated_at) ?? new Date().toISOString(),
  }))
}

/** 返回 true 表示这是一条新回访（之前没记录过同版本）。 */
export async function recordIntegrationImpact(
  pool: DbPool,
  input: {
    userId: number
    projectFullName: string
    suggestionRepo: string
    kind?: 'release' | 'advisory'
    version: string
    title: string | null
    url: string | null
    publishedAt: string | null
  },
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `INSERT INTO integration_impacts
       (user_id, project_full_name, suggestion_repo, kind, version, title, url, published_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (user_id, suggestion_repo, version) DO NOTHING`,
    [
      input.userId,
      input.projectFullName,
      input.suggestionRepo,
      input.kind ?? 'release',
      input.version,
      input.title,
      input.url,
      input.publishedAt,
    ],
  )
  return (rowCount ?? 0) > 0
}

export async function listIntegrationImpacts(
  pool: DbPool,
  userId: number,
  limit = 5,
): Promise<IntegrationImpact[]> {
  const { rows } = await pool.query<ImpactRow>(
    `SELECT id, project_full_name, suggestion_repo, kind, version, title, url, published_at, created_at
     FROM integration_impacts
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, Math.max(1, Math.min(50, limit))],
  )
  return rows.map((row) => ({
    id: Number(row.id),
    projectFullName: row.project_full_name,
    suggestionRepo: row.suggestion_repo,
    kind: row.kind === 'advisory' ? 'advisory' : 'release',
    version: row.version,
    title: row.title,
    url: row.url,
    publishedAt: iso(row.published_at),
    createdAt: iso(row.created_at) ?? new Date().toISOString(),
  }))
}

/**
 * 检查已接入的库是否发布了新版本。
 * 只回访「接入之后」发布的版本，避免刚标记接入就收到历史版本通知。
 */
/**
 * 从项目的 lockfile 里解析出某个包的真实安装版本。
 * 解析不到时返回 null，调用方回退到「按包查全部公告」。
 */
export function resolveInstalledVersion(
  context: IntegrationProjectInput | null,
  packageName: string,
): string | null {
  if (!context?.lockfileName || !context.lockfile) return null
  const versions = parseLockfileVersions(context.lockfileName, context.lockfile)
  for (const candidate of [packageName, packageName.replace(/^@[^/]+\//, '')]) {
    const version = versions.get(candidate)
    if (version) return version
  }
  return null
}

function guessEcosystem(language: string | null): 'npm' | 'pypi' | 'go' | 'cargo' {
  const value = (language ?? '').toLowerCase()
  if (value.includes('python')) return 'pypi'
  if (value === 'go') return 'go'
  if (value.includes('rust')) return 'cargo'
  return 'npm'
}

const versionCache = new Map<string, { expires: number; value: string | null }>()
const VERSION_CACHE_TTL = 6 * 60 * 60 * 1000

async function installedVersionFor(
  project: string,
  packageName: string,
  token: string | null | undefined,
): Promise<string | null> {
  const key = `${project.toLowerCase()}:${packageName}`
  const cached = versionCache.get(key)
  if (cached && cached.expires > Date.now()) return cached.value
  try {
    const context = await loadProjectContext(project, token ?? null)
    const value = resolveInstalledVersion(context, packageName)
    versionCache.set(key, { expires: Date.now() + VERSION_CACHE_TTL, value })
    return value
  } catch {
    return null
  }
}

/** 包名用仓库名近似；能解析到安装版本时按精确版本查，否则查全部公告。 */
async function checkAdvisories(
  pool: DbPool,
  item: AdoptedIntegration,
  token?: string | null,
): Promise<number> {
  const [owner, repoName] = item.suggestionRepo.split('/')
  if (!owner || !repoName) return 0
  const record = await findRepoByFullName(pool, item.suggestionRepo)
  const ecosystem = guessEcosystem(record?.language ?? null)
  const installedVersion = await installedVersionFor(item.projectFullName, repoName, token)
  const vulnerabilities = installedVersion
    ? await queryOsv(repoName, installedVersion, ecosystem)
    : await queryOsvPackage(repoName, ecosystem)
  if (vulnerabilities.length === 0) return 0

  let created = 0
  for (const vulnerability of vulnerabilities) {
    const inserted = await recordIntegrationImpact(pool, {
      userId: item.userId,
      projectFullName: item.projectFullName,
      suggestionRepo: item.suggestionRepo,
      kind: 'advisory',
      version: `osv:${vulnerability.id}`,
      title: vulnerability.summary ?? vulnerability.id,
      url: `https://osv.dev/vulnerability/${vulnerability.id}`,
      publishedAt: null,
    })
    if (!inserted) continue
    created += 1
    await addNotification(pool, item.userId, {
      kind: 'security',
      title: `接入的库有安全公告：${item.suggestionRepo}`,
      body: `${vulnerability.id}${installedVersion ? ` · 已安装 ${installedVersion}` : ''}${vulnerability.severity ? ` · ${vulnerability.severity}` : ''}${vulnerability.summary ? `：${vulnerability.summary}` : ''}`,
      url: '/workbench/integrations',
    })
  }
  return created
}

export async function checkIntegrationImpacts(
  pool: DbPool,
  options: { token?: string | null; limit?: number } = {},
): Promise<number> {
  const adopted = await listAdoptedIntegrations(pool, options.limit ?? 25)
  let created = 0

  for (const item of adopted) {
    try {
      const release = await fetchLatestRelease(item.suggestionRepo, options.token ?? undefined)
      const isNewRelease = (() => {
        if (!release) return false
        if (!release.publishedAt) return true
        const published = Date.parse(release.publishedAt)
        const adoptedAt = Date.parse(item.adoptedAt)
        if (!Number.isFinite(published) || !Number.isFinite(adoptedAt)) return true
        return published > adoptedAt
      })()

      if (release && isNewRelease) {
        const inserted = await recordIntegrationImpact(pool, {
          userId: item.userId,
          projectFullName: item.projectFullName,
          suggestionRepo: item.suggestionRepo,
          version: release.tag,
          title: release.name,
          url: release.url,
          publishedAt: release.publishedAt,
        })
        if (inserted) {
          created += 1
          await addNotification(pool, item.userId, {
            kind: 'release',
            title: `接入的库有新版本：${item.suggestionRepo} ${release.tag}`,
            body: `${item.projectFullName} 正在使用它${release.name ? `：${release.name}` : ''}`,
            url: '/workbench/integrations',
          })
        }
      }

      // 安全公告和 release 相互独立：没有 release 的仓库也要查。
      created += await checkAdvisories(pool, item, options.token)
    } catch (error) {
      logEvent('warn', 'integration_impact.check_failed', {
        repo: item.suggestionRepo,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return created
}
