import type { DbPool } from './db.js'
import type { StoredComparisonReport } from './comparison.js'
import type { StoredDiscoverabilityReport } from './discoverability.js'
import type { StoredIntegrationReport } from './integrations.js'
import type { StoredIssuePlan } from './issue-plan.js'
import type { StoredMaintainerReport } from './maintainer.js'

export type HistoryKind =
  | 'integration'
  | 'maintainer'
  | 'issue'
  | 'discoverability'
  | 'comparison'
  | 'issue-plan'
  | 'patch'
  | 'watch'

export interface HistoryEntry {
  kind: HistoryKind
  id: number
  title: string
  subtitle: string | null
  createdAt: string
  model: string | null
  providerId: string | null
  href: string
}

export const HISTORY_LABEL: Record<HistoryKind, string> = {
  integration: '接入建议',
  maintainer: '维护周报',
  issue: '技术周报',
  discoverability: '曝光优化',
  comparison: '选型对比',
  'issue-plan': '修复方案',
  watch: '关注代理',
  patch: '修复补丁',
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value
}

function time(value: string): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * 汇总所有 AI 生成内容。只读，用来确认旧版本仍然存在并回看。
 */
export async function listHistory(
  pool: DbPool,
  userId: number,
  limit = 50,
  offset = 0,
  kind?: HistoryKind,
): Promise<HistoryEntry[]> {
  const perKind = Math.max(5, Math.min(1000, limit + Math.max(0, offset)))
  const [integrations, maintainers, drafts, discoverability, comparisons, issuePlans, watchRuns, patches] =
    await Promise.all([
    pool.query<{ id: string; created_at: Date | string; payload: StoredIntegrationReport }>(
      `SELECT id, created_at, payload FROM integration_reports
       WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [userId, perKind],
    ),
    pool.query<{ id: string; created_at: Date | string; payload: StoredMaintainerReport }>(
      `SELECT id, created_at, payload FROM maintainer_reports
       WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [userId, perKind],
    ),
    pool.query<{
      id: string
      title: string
      created_at: Date | string
      model: string | null
      provider_id: string | null
    }>(
      `SELECT id, title, created_at, model, provider_id FROM issue_drafts
       WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [userId, perKind],
    ),
    pool.query<{
      id: string
      repo_full_name: string
      created_at: Date | string
      payload: StoredDiscoverabilityReport
    }>(
      `SELECT id, repo_full_name, created_at, payload FROM discoverability_reports
       WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [userId, perKind],
    ),
    pool.query<{
      id: string
      project_full_name: string
      created_at: Date | string
      payload: StoredComparisonReport
    }>(
      `SELECT id, project_full_name, created_at, payload FROM comparison_reports
       WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [userId, perKind],
    ),
    pool.query<{
      id: string
      repo_full_name: string
      issue_number: number
      created_at: Date | string
      payload: StoredIssuePlan
    }>(
      `SELECT id, repo_full_name, issue_number, created_at, payload FROM issue_plans
       WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [userId, perKind],
    ),
    pool.query<{
      id: string
      text: string
      match_count: number
      model: string | null
      provider_id: string | null
      created_at: Date | string
    }>(
      `SELECT r.id, i.text, r.match_count, r.model, r.provider_id, r.created_at
       FROM watch_runs r
       JOIN watch_intents i ON i.id = r.intent_id
       WHERE i.user_id = $1 ORDER BY r.created_at DESC LIMIT $2`,
      [userId, perKind],
    ),
    pool.query<{
      id: string
      title: string
      summary: string | null
      status: string
      created_at: Date | string
    }>(
      `SELECT id, title, summary, status, created_at
       FROM patch_drafts WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [userId, perKind],
    ),
  ])

  const entries: HistoryEntry[] = []

  for (const row of integrations.rows) {
    const payload = row.payload
    const projects = payload.report?.projects?.map((project) => project.repo) ?? []
    entries.push({
      kind: 'integration',
      id: Number(row.id),
      title: `接入建议 · ${projects.slice(0, 2).join('、') || '未记录项目'}`,
      subtitle: payload.focus ? `本轮关注：${payload.focus}` : null,
      createdAt: iso(row.created_at),
      model: payload.model ?? null,
      providerId: payload.providerId ?? null,
      href: `/workbench/integrations?report=${row.id}`,
    })
  }

  for (const row of maintainers.rows) {
    const payload = row.payload
    const projects = payload.usedProjects?.length
      ? payload.usedProjects
      : (payload.report?.projects?.map((project) => project.repo) ?? [])
    entries.push({
      kind: 'maintainer',
      id: Number(row.id),
      title: `维护周报 · ${projects.slice(0, 2).join('、') || '未记录项目'}`,
      subtitle: payload.warnings?.length ? `${payload.warnings.length} 条数据提示` : null,
      createdAt: iso(row.created_at),
      model: payload.model ?? null,
      providerId: payload.providerId ?? null,
      href: `/workbench/maintain?report=${row.id}`,
    })
  }

  for (const row of drafts.rows) {
    entries.push({
      kind: 'issue',
      id: Number(row.id),
      title: `技术周报 · ${row.title}`,
      subtitle: null,
      createdAt: iso(row.created_at),
      model: row.model ?? null,
      providerId: row.provider_id ?? null,
      href: `/workbench/issue?draft=${row.id}`,
    })
  }

  for (const row of discoverability.rows) {
    entries.push({
      kind: 'discoverability',
      id: Number(row.id),
      title: `曝光优化 · ${row.repo_full_name}`,
      subtitle: `评分 ${row.payload.report?.score ?? '—'}`,
      createdAt: iso(row.created_at),
      model: row.payload.model ?? null,
      providerId: row.payload.providerId ?? null,
      href: `/repos/${row.repo_full_name}/optimize?report=${row.id}`,
    })
  }

  for (const row of comparisons.rows) {
    entries.push({
      kind: 'comparison',
      id: Number(row.id),
      title: `选型对比 · ${row.project_full_name}`,
      subtitle: row.payload.report?.recommendation?.repo
        ? `推荐 ${row.payload.report.recommendation.repo}`
        : null,
      createdAt: iso(row.created_at),
      model: row.payload.model ?? null,
      providerId: row.payload.providerId ?? null,
      href: `/compare?project=${encodeURIComponent(row.project_full_name)}&report=${row.id}`,
    })
  }

  for (const row of issuePlans.rows) {
    entries.push({
      kind: 'issue-plan',
      id: Number(row.id),
      title: `修复方案 · ${row.repo_full_name} #${row.issue_number}`,
      subtitle: row.payload.issueTitle ?? null,
      createdAt: iso(row.created_at),
      model: row.payload.model ?? null,
      providerId: row.payload.providerId ?? null,
      href: `/issue-plan?repo=${encodeURIComponent(row.repo_full_name)}&number=${row.issue_number}&plan=${row.id}`,
    })
  }

  for (const row of patches.rows) {
    entries.push({
      kind: 'patch',
      id: Number(row.id),
      title: row.title,
      subtitle: row.summary
        ? `${row.status === 'validated' ? '已验证' : row.status === 'failed' ? '验证未通过' : '草稿'} · ${row.summary}`
        : row.status,
      createdAt: iso(row.created_at),
      model: null,
      providerId: null,
      href: `/patch/${row.id}`,
    })
  }

  for (const row of watchRuns.rows) {
    entries.push({
      kind: 'watch',
      id: Number(row.id),
      title: `关注代理 · ${row.text}`,
      subtitle: `${row.match_count} 个匹配`,
      createdAt: iso(row.created_at),
      model: row.model ?? null,
      providerId: row.provider_id ?? null,
      href: '/workbench/watch',
    })
  }

  const scoped = kind ? entries.filter((entry) => entry.kind === kind) : entries
  return scoped
    .sort((left, right) => time(right.createdAt) - time(left.createdAt))
    .slice(Math.max(0, offset), Math.max(0, offset) + limit)
}


export interface HistoryContentExport {
  exportedAt: string
  login: string | null
  integration: Array<{ id: number; createdAt: string; payload: unknown }>
  maintainer: Array<{ id: number; createdAt: string; payload: unknown }>
  discoverability: Array<{ id: number; repo: string; createdAt: string; payload: unknown }>
  comparison: Array<{ id: number; project: string; createdAt: string; payload: unknown }>
  issuePlans: Array<{ id: number; repo: string; issueNumber: number; createdAt: string; payload: unknown }>
  issueDrafts: Array<{
    id: number
    title: string
    summary: string | null
    html: string
    markdown: string
    model: string | null
    providerId: string | null
    createdAt: string
  }>
  watchRuns: Array<{
    id: number
    intent: string
    matchCount: number
    model: string | null
    providerId: string | null
    createdAt: string
  }>
  patches: Array<{
    id: number
    title: string
    summary: string | null
    patch: string
    files: unknown
    status: string
    validation: unknown
    createdAt: string
  }>
}

/** 导出完整历史内容（报告正文、补丁、周报 HTML 等），用于迁移或离线归档。 */
export async function exportHistoryContent(
  pool: DbPool,
  userId: number,
  limit = 200,
): Promise<Omit<HistoryContentExport, 'exportedAt' | 'login'>> {
  const size = Math.max(1, Math.min(500, limit))
  const [integration, maintainer, discoverability, comparison, issuePlans, issueDrafts, watchRuns, patches] =
    await Promise.all([
      pool.query<{ id: string; created_at: Date | string; payload: unknown }>(
        `SELECT id, created_at, payload FROM integration_reports
         WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [userId, size],
      ),
      pool.query<{ id: string; created_at: Date | string; payload: unknown }>(
        `SELECT id, created_at, payload FROM maintainer_reports
         WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [userId, size],
      ),
      pool.query<{ id: string; repo_full_name: string; created_at: Date | string; payload: unknown }>(
        `SELECT id, repo_full_name, created_at, payload FROM discoverability_reports
         WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [userId, size],
      ),
      pool.query<{ id: string; project_full_name: string; created_at: Date | string; payload: unknown }>(
        `SELECT id, project_full_name, created_at, payload FROM comparison_reports
         WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [userId, size],
      ),
      pool.query<{
        id: string
        repo_full_name: string
        issue_number: number
        created_at: Date | string
        payload: unknown
      }>(
        `SELECT id, repo_full_name, issue_number, created_at, payload FROM issue_plans
         WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [userId, size],
      ),
      pool.query<{
        id: string
        title: string
        summary: string | null
        html: string
        markdown: string
        model: string | null
        provider_id: string | null
        created_at: Date | string
      }>(
        `SELECT id, title, summary, html, markdown, model, provider_id, created_at FROM issue_drafts
         WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [userId, size],
      ),
      pool.query<{
        id: string
        text: string
        match_count: number
        model: string | null
        provider_id: string | null
        created_at: Date | string
      }>(
        `SELECT r.id, i.text, r.match_count, r.model, r.provider_id, r.created_at
         FROM watch_runs r JOIN watch_intents i ON i.id = r.intent_id
         WHERE i.user_id = $1 ORDER BY r.created_at DESC LIMIT $2`,
        [userId, size],
      ),
      pool.query<{
        id: string
        title: string
        summary: string | null
        patch: string
        files: unknown
        status: string
        validation: unknown
        created_at: Date | string
      }>(
        `SELECT id, title, summary, patch, files, status, validation, created_at FROM patch_drafts
         WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [userId, size],
      ),
    ])

  return {
    integration: integration.rows.map((row) => ({ id: Number(row.id), createdAt: iso(row.created_at), payload: row.payload })),
    maintainer: maintainer.rows.map((row) => ({ id: Number(row.id), createdAt: iso(row.created_at), payload: row.payload })),
    discoverability: discoverability.rows.map((row) => ({
      id: Number(row.id),
      repo: row.repo_full_name,
      createdAt: iso(row.created_at),
      payload: row.payload,
    })),
    comparison: comparison.rows.map((row) => ({
      id: Number(row.id),
      project: row.project_full_name,
      createdAt: iso(row.created_at),
      payload: row.payload,
    })),
    issuePlans: issuePlans.rows.map((row) => ({
      id: Number(row.id),
      repo: row.repo_full_name,
      issueNumber: Number(row.issue_number),
      createdAt: iso(row.created_at),
      payload: row.payload,
    })),
    issueDrafts: issueDrafts.rows.map((row) => ({
      id: Number(row.id),
      title: row.title,
      summary: row.summary,
      html: row.html,
      markdown: row.markdown,
      model: row.model,
      providerId: row.provider_id,
      createdAt: iso(row.created_at),
    })),
    watchRuns: watchRuns.rows.map((row) => ({
      id: Number(row.id),
      intent: row.text,
      matchCount: Number(row.match_count),
      model: row.model,
      providerId: row.provider_id,
      createdAt: iso(row.created_at),
    })),
    patches: patches.rows.map((row) => ({
      id: Number(row.id),
      title: row.title,
      summary: row.summary,
      patch: row.patch,
      files: row.files,
      status: row.status,
      validation: row.validation,
      createdAt: iso(row.created_at),
    })),
  }
}
