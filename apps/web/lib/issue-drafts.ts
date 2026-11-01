import type { DbPool } from '@repo-radar/core'

export interface IssueDraftRecord {
  id: number
  title: string
  summary: string[]
  html: string
  markdown: string
  createdAt: string
  model: string | null
  providerId: string | null
  promptVersion: string | null
}

interface IssueDraftRow {
  id: string
  title: string
  summary: string[] | null
  html: string
  markdown: string
  created_at: Date | string
  model: string | null
  provider_id: string | null
  prompt_version: string | null
}

function mapRow(row: IssueDraftRow): IssueDraftRecord {
  return {
    id: Number(row.id),
    title: row.title,
    summary: row.summary ?? [],
    html: row.html,
    markdown: row.markdown,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    model: row.model ?? null,
    providerId: row.provider_id ?? null,
    promptVersion: row.prompt_version ?? null,
  }
}

export async function saveIssueDraft(
  pool: DbPool,
  input: {
    userId: number
    title: string
    summary: string[]
    html: string
    markdown: string
    model?: string | null
    providerId?: string | null
    promptVersion?: string | null
  },
): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO issue_drafts (user_id, title, summary, html, markdown, model, provider_id, prompt_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      input.userId,
      input.title,
      JSON.stringify(input.summary),
      input.html,
      input.markdown,
      input.model ?? null,
      input.providerId ?? null,
      input.promptVersion ?? null,
    ],
  )
  return Number(rows[0]?.id ?? 0)
}

export async function listIssueDrafts(pool: DbPool, userId: number, limit = 20): Promise<IssueDraftRecord[]> {
  const { rows } = await pool.query<IssueDraftRow>(
    `SELECT id, title, summary, html, markdown, created_at, model, provider_id, prompt_version
     FROM issue_drafts
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit],
  )
  return rows.map(mapRow)
}

export async function findLatestIssueDraft(pool: DbPool, userId: number): Promise<IssueDraftRecord | null> {
  const { rows } = await pool.query<IssueDraftRow>(
    `SELECT id, title, summary, html, markdown, created_at, model, provider_id, prompt_version
     FROM issue_drafts
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId],
  )
  const row = rows[0]
  return row ? mapRow(row) : null
}

export async function findIssueDraft(
  pool: DbPool,
  userId: number,
  id: number,
): Promise<IssueDraftRecord | null> {
  const { rows } = await pool.query<IssueDraftRow>(
    `SELECT id, title, summary, html, markdown, created_at, model, provider_id, prompt_version
     FROM issue_drafts
     WHERE user_id = $1 AND id = $2
     LIMIT 1`,
    [userId, id],
  )
  const row = rows[0]
  return row ? mapRow(row) : null
}
