import type { DbPool } from './db.js'
import { fetchLatestRelease } from './github.js'
import { logEvent } from './logger.js'
import { addNotification } from './notifications.js'

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
    version: string
    title: string | null
    url: string | null
    publishedAt: string | null
  },
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `INSERT INTO integration_impacts
       (user_id, project_full_name, suggestion_repo, version, title, url, published_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id, suggestion_repo, version) DO NOTHING`,
    [
      input.userId,
      input.projectFullName,
      input.suggestionRepo,
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
    `SELECT id, project_full_name, suggestion_repo, version, title, url, published_at, created_at
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
export async function checkIntegrationImpacts(
  pool: DbPool,
  options: { token?: string | null; limit?: number } = {},
): Promise<number> {
  const adopted = await listAdoptedIntegrations(pool, options.limit ?? 25)
  let created = 0

  for (const item of adopted) {
    try {
      const release = await fetchLatestRelease(item.suggestionRepo, options.token ?? undefined)
      if (!release) continue
      if (release.publishedAt) {
        const published = Date.parse(release.publishedAt)
        const adoptedAt = Date.parse(item.adoptedAt)
        if (Number.isFinite(published) && Number.isFinite(adoptedAt) && published <= adoptedAt) continue
      }

      const inserted = await recordIntegrationImpact(pool, {
        userId: item.userId,
        projectFullName: item.projectFullName,
        suggestionRepo: item.suggestionRepo,
        version: release.tag,
        title: release.name,
        url: release.url,
        publishedAt: release.publishedAt,
      })
      if (!inserted) continue
      created += 1

      await addNotification(pool, item.userId, {
        kind: 'release',
        title: `接入的库有新版本：${item.suggestionRepo} ${release.tag}`,
        body: `${item.projectFullName} 正在使用它${release.name ? `：${release.name}` : ''}`,
        url: '/workbench/integrations',
      })
    } catch (error) {
      logEvent('warn', 'integration_impact.check_failed', {
        repo: item.suggestionRepo,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return created
}
