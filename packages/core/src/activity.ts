import type { DbPool } from './db.js'
import { githubApiBase } from './github.js'
import { addNotification } from './notifications.js'
import { listUserProjects } from './user-projects.js'
import { loadNotificationPrefs } from './users.js'

function notificationAllowed(kind: string, prefs: Awaited<ReturnType<typeof loadNotificationPrefs>>): boolean {
  if (kind === 'github-star') return prefs.githubStar
  if (kind === 'github-fork') return prefs.githubFork
  if (kind === 'github-issue') return prefs.githubIssue
  if (kind === 'github-pr') return prefs.githubPull
  if (kind === 'github-release') return prefs.githubRelease
  return true
}

export interface ActivitySyncResult {
  repos: number
  initialized: number
  events: number
  notifications: number
  warnings: string[]
}

export interface RepoEvent {
  id?: string
  type?: string
  actor?: { login?: string }
  repo?: { name?: string }
  created_at?: string
  payload?: {
    action?: string
    forkee?: { full_name?: string; html_url?: string }
    issue?: { number?: number; title?: string; html_url?: string }
    pull_request?: { number?: number; title?: string; html_url?: string }
    release?: { tag_name?: string; name?: string; html_url?: string }
  }
}

export interface ActivityItem {
  key: string
  kind: string
  title: string
  body: string
  url: string
  actor: string
}

function headers(token: string): Record<string, string> {
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'x-github-api-version': '2022-11-28',
    'user-agent': 'repo-radar',
  }
}

async function fetchRepoEvents(token: string, fullName: string): Promise<RepoEvent[]> {
  const response = await fetch(`${githubApiBase()}/repos/${fullName}/events?per_page=30`, {
    headers: headers(token),
    signal: AbortSignal.timeout(8000),
    cache: 'no-store',
  } as RequestInit & { cache: 'no-store' })
  if (!response.ok) throw new Error(`GitHub events API ${response.status}`)
  const data = (await response.json()) as RepoEvent[]
  return Array.isArray(data) ? data : []
}

export function toActivity(fullName: string, event: RepoEvent): ActivityItem | null {
  if (!event.id || !event.type) return null
  const actor = event.actor?.login ?? 'someone'
  const payload = event.payload ?? {}
  const repoUrl = `https://github.com/${fullName}`

  if (event.type === 'WatchEvent') {
    return {
      key: event.id,
      kind: 'github-star',
      title: `${actor} star 了 ${fullName}`,
      body: '你的仓库多了一个 star。',
      url: repoUrl,
      actor,
    }
  }
  if (event.type === 'ForkEvent') {
    const fork = payload.forkee
    return {
      key: event.id,
      kind: 'github-fork',
      title: `${actor} fork 了 ${fullName}`,
      body: fork?.full_name ? `新仓库：${fork.full_name}` : '你的仓库多了一个 fork。',
      url: fork?.html_url ?? repoUrl,
      actor,
    }
  }
  if (event.type === 'IssuesEvent' && payload.action === 'opened' && payload.issue?.number) {
    return {
      key: event.id,
      kind: 'github-issue',
      title: `${actor} 在 ${fullName} 打开了 Issue #${payload.issue.number}`,
      body: payload.issue.title ?? '',
      url: payload.issue.html_url ?? repoUrl,
      actor,
    }
  }
  if (event.type === 'PullRequestEvent' && payload.action === 'opened' && payload.pull_request?.number) {
    return {
      key: event.id,
      kind: 'github-pr',
      title: `${actor} 在 ${fullName} 打开了 PR #${payload.pull_request.number}`,
      body: payload.pull_request.title ?? '',
      url: payload.pull_request.html_url ?? repoUrl,
      actor,
    }
  }
  if (event.type === 'ReleaseEvent' && payload.action === 'published' && payload.release?.tag_name) {
    return {
      key: event.id,
      kind: 'github-release',
      title: `${fullName} 发布了 ${payload.release.tag_name}`,
      body: payload.release.name ?? '新版本已发布',
      url: payload.release.html_url ?? repoUrl,
      actor,
    }
  }
  return null
}

/**
 * 用仓库事件 API 检查 star / fork / opened issue / opened PR / release。
 * 第一次同步只建立基线，不通知历史事件；之后只通知新事件。
 */
export async function syncRepoActivity(
  pool: DbPool,
  userId: number,
  login: string,
  token: string,
  options: { maxProjects?: number; maxNotifications?: number } = {},
): Promise<ActivitySyncResult> {
  const projects = (await listUserProjects(pool, userId)).filter((project) => project.active)
  const selected = projects.slice(0, options.maxProjects ?? 15)
  const result: ActivitySyncResult = {
    repos: selected.length,
    initialized: 0,
    events: 0,
    notifications: 0,
    warnings: [],
  }
  const notificationLimit = options.maxNotifications ?? 30
  const notificationPrefs = await loadNotificationPrefs(pool, userId)

  for (const project of selected) {
    const fullName = project.repoFullName
    let events: RepoEvent[]
    try {
      events = await fetchRepoEvents(token, fullName)
    } catch (error) {
      result.warnings.push(`${fullName}：${error instanceof Error ? error.message : '读取动态失败'}`)
      continue
    }

    const state = await pool.query<{ initialized: boolean }>(
      `SELECT initialized FROM activity_sync_state WHERE user_id = $1 AND repo_full_name = $2`,
      [userId, fullName],
    )
    const initialized = state.rows[0]?.initialized ?? false
    const activities = events
      .map((event) => toActivity(fullName, event))
      .filter((item): item is ActivityItem => Boolean(item))
    result.events += activities.length

    for (const activity of activities) {
      const inserted = await pool.query<{ external_id: string }>(
        `INSERT INTO activity_seen (user_id, repo_full_name, kind, external_id, actor, title, url)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (user_id, repo_full_name, kind, external_id) DO NOTHING
         RETURNING external_id`,
        [userId, fullName, activity.kind, activity.key, activity.actor, activity.title, activity.url],
      )
      if (!inserted.rows[0]) continue

      if (!initialized) continue
      if (activity.actor.toLowerCase() === login.toLowerCase()) continue
      if (!notificationAllowed(activity.kind, notificationPrefs)) continue
      if (result.notifications >= notificationLimit) continue

      await addNotification(pool, userId, {
        kind: activity.kind,
        title: activity.title,
        body: activity.body,
        url: activity.url,
      })
      result.notifications++
    }

    if (!initialized) result.initialized++
    await pool.query(
      `INSERT INTO activity_sync_state (user_id, repo_full_name, initialized, last_synced_at)
       VALUES ($1, $2, TRUE, now())
       ON CONFLICT (user_id, repo_full_name) DO UPDATE SET
         initialized = TRUE,
         last_synced_at = now()`,
      [userId, fullName],
    )
  }

  return result
}
