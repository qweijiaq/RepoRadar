import { z } from 'zod'
import type { DbPool } from './db.js'
import { addNotification } from './notifications.js'
import { toActivity, type ActivityItem, type RepoEvent } from './activity.js'
import { loadNotificationPrefs, type NotificationPrefs } from './users.js'

export interface GitHubWebhookPayload {
  action?: string
  repository?: { full_name?: string }
  sender?: { login?: string }
  forkee?: { full_name?: string; html_url?: string }
  issue?: { number?: number; title?: string; html_url?: string }
  pull_request?: { number?: number; title?: string; html_url?: string }
  release?: { tag_name?: string; name?: string; html_url?: string }
}

export const githubWebhookPayloadSchema = z
  .object({
    action: z.string().optional(),
    repository: z
      .object({ full_name: z.string().optional() })
      .passthrough()
      .nullable()
      .optional(),
    sender: z
      .object({ login: z.string().optional() })
      .passthrough()
      .nullable()
      .optional(),
    forkee: z
      .object({ full_name: z.string().optional(), html_url: z.string().optional() })
      .passthrough()
      .nullable()
      .optional(),
    issue: z
      .object({
        number: z.number().optional(),
        title: z.string().optional(),
        html_url: z.string().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    pull_request: z
      .object({
        number: z.number().optional(),
        title: z.string().optional(),
        html_url: z.string().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    release: z
      .object({
        tag_name: z.string().optional(),
        name: z.string().optional(),
        html_url: z.string().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough()

export function parseGitHubWebhookPayload(value: unknown): GitHubWebhookPayload | null {
  const result = githubWebhookPayloadSchema.safeParse(value)
  return result.success ? (result.data as GitHubWebhookPayload) : null
}

export function webhookToActivity(
  eventName: string,
  deliveryId: string,
  payload: GitHubWebhookPayload,
): ActivityItem | null {
  const repo = payload.repository?.full_name
  if (!repo) return null
  const actor = payload.sender?.login ?? 'someone'
  let event: RepoEvent | null = null

  if (eventName === 'watch') {
    event = { id: deliveryId, type: 'WatchEvent', actor: { login: actor }, payload: { action: 'started' } }
  } else if (eventName === 'fork') {
    event = {
      id: deliveryId,
      type: 'ForkEvent',
      actor: { login: actor },
      payload: { forkee: payload.forkee },
    }
  } else if (eventName === 'issues' && payload.action === 'opened') {
    event = {
      id: deliveryId,
      type: 'IssuesEvent',
      actor: { login: actor },
      payload: { action: 'opened', issue: payload.issue },
    }
  } else if (eventName === 'pull_request' && payload.action === 'opened') {
    event = {
      id: deliveryId,
      type: 'PullRequestEvent',
      actor: { login: actor },
      payload: { action: 'opened', pull_request: payload.pull_request },
    }
  } else if (eventName === 'release' && payload.action === 'published') {
    event = {
      id: deliveryId,
      type: 'ReleaseEvent',
      actor: { login: actor },
      payload: { action: 'published', release: payload.release },
    }
  }

  return event ? toActivity(repo, event) : null
}

function allowed(kind: string, prefs: NotificationPrefs): boolean {
  if (kind === 'github-star') return prefs.githubStar
  if (kind === 'github-fork') return prefs.githubFork
  if (kind === 'github-issue') return prefs.githubIssue
  if (kind === 'github-pr') return prefs.githubPull
  if (kind === 'github-release') return prefs.githubRelease
  return true
}

export async function handleGitHubWebhook(
  pool: DbPool,
  eventName: string,
  deliveryId: string,
  payload: GitHubWebhookPayload,
): Promise<number> {
  const repo = payload.repository?.full_name
  const activity = webhookToActivity(eventName, deliveryId, payload)
  if (!repo || !activity) return 0

  const { rows } = await pool.query<{ id: string; login: string }>(
    `SELECT u.id, u.login
     FROM user_projects p
     JOIN users u ON u.id = p.user_id
     WHERE p.repo_full_name = $1 AND p.active = TRUE`,
    [repo],
  )

  let notified = 0
  for (const row of rows) {
    const userId = Number(row.id)
    const inserted = await pool.query<{ external_id: string }>(
      `INSERT INTO activity_seen (user_id, repo_full_name, kind, external_id, actor, title, url)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, repo_full_name, kind, external_id) DO NOTHING
       RETURNING external_id`,
      [userId, repo, activity.kind, deliveryId, activity.actor, activity.title, activity.url],
    )
    if (!inserted.rows[0]) continue
    if (activity.actor.toLowerCase() === row.login.toLowerCase()) continue

    const prefs = await loadNotificationPrefs(pool, userId)
    if (!allowed(activity.kind, prefs)) continue

    await addNotification(pool, userId, {
      kind: activity.kind,
      title: activity.title,
      body: activity.body,
      url: activity.url,
    })
    notified++
  }
  return notified
}
