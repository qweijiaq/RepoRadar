import type { DbPool } from './db.js'

export type IntegrationOutcomeStatus = 'adopted' | 'rejected'

export interface IntegrationOutcome {
  projectFullName: string
  suggestionRepo: string
  status: IntegrationOutcomeStatus
  note: string | null
  updatedAt: string
}

export async function setIntegrationOutcome(
  pool: DbPool,
  userId: number,
  projectFullName: string,
  suggestionRepo: string,
  status: IntegrationOutcomeStatus,
  note: string | null = null,
): Promise<void> {
  await pool.query(
    `INSERT INTO integration_outcomes (user_id, project_full_name, suggestion_repo, status, note)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, project_full_name, suggestion_repo) DO UPDATE SET
       status = EXCLUDED.status,
       note = EXCLUDED.note,
       updated_at = now()`,
    [userId, projectFullName, suggestionRepo, status, note],
  )
}

export async function clearIntegrationOutcome(
  pool: DbPool,
  userId: number,
  projectFullName: string,
  suggestionRepo: string,
): Promise<void> {
  await pool.query(
    `DELETE FROM integration_outcomes
     WHERE user_id = $1 AND project_full_name = $2 AND suggestion_repo = $3`,
    [userId, projectFullName, suggestionRepo],
  )
}

export async function listIntegrationOutcomes(
  pool: DbPool,
  userId: number,
): Promise<IntegrationOutcome[]> {
  const { rows } = await pool.query<{
    project_full_name: string
    suggestion_repo: string
    status: IntegrationOutcomeStatus
    note: string | null
    updated_at: Date | string
  }>(
    `SELECT project_full_name, suggestion_repo, status, note, updated_at
     FROM integration_outcomes WHERE user_id = $1
     ORDER BY updated_at DESC`,
    [userId],
  )
  return rows.map((row) => ({
    projectFullName: row.project_full_name,
    suggestionRepo: row.suggestion_repo,
    status: row.status,
    note: row.note,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  }))
}
