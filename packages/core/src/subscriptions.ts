import type { DbPool } from './db.js'
import { round } from './utils.js'

export type SubscriptionKind = 'topic' | 'language' | 'author' | 'release'

export interface Subscription {
  kind: SubscriptionKind
  value: string
}

export const SUBSCRIPTION_KINDS: SubscriptionKind[] = ['topic', 'language', 'author', 'release']

export function normalizeSubscriptionValue(kind: SubscriptionKind, value: string): string {
  const trimmed = value.trim()
  return kind === 'topic' ? trimmed.toLowerCase() : trimmed
}

export function isValidSubscriptionValue(kind: SubscriptionKind, value: string): boolean {
  const normalized = normalizeSubscriptionValue(kind, value)
  if (normalized.length === 0 || normalized.length > 120) return false

  if (kind === 'topic') return /^[a-z0-9][a-z0-9._-]*$/i.test(normalized)
  if (kind === 'language') return /^[a-z0-9+#.-]+$/i.test(normalized) && !/^\d+$/.test(normalized)
  if (kind === 'author') return /^[a-z0-9-]+$/i.test(normalized)
  return /^[a-z0-9._-]+\/[a-z0-9._-]+$/i.test(normalized)
}

export async function loadSubscriptions(pool: DbPool, userId: number): Promise<Subscription[]> {
  const { rows } = await pool.query<{ kind: SubscriptionKind; value: string }>(
    `SELECT kind, value FROM subscriptions WHERE user_id = $1 ORDER BY created_at, kind, value`,
    [userId],
  )
  return rows.map((row) => ({ kind: row.kind, value: row.value }))
}

export async function addSubscription(
  pool: DbPool,
  userId: number,
  kind: SubscriptionKind,
  value: string,
): Promise<void> {
  const normalized = normalizeSubscriptionValue(kind, value)
  await pool.query(
    `INSERT INTO subscriptions (user_id, kind, value) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, kind, value) DO NOTHING`,
    [userId, kind, normalized],
  )
}

export async function removeSubscription(
  pool: DbPool,
  userId: number,
  kind: SubscriptionKind,
  value: string,
): Promise<void> {
  const normalized = normalizeSubscriptionValue(kind, value)
  await pool.query(`DELETE FROM subscriptions WHERE user_id = $1 AND kind = $2 AND value = $3`, [
    userId,
    kind,
    normalized,
  ])
}

export function computeSubscriptionBonus(
  repo: { fullName: string; owner: string; topics: string[]; language: string | null },
  subscriptions: Subscription[],
): number {
  if (subscriptions.length === 0) return 0

  const topics = new Set(repo.topics.map((topic) => topic.toLowerCase()))
  const language = repo.language?.toLowerCase() ?? null
  const owner = repo.owner.toLowerCase()
  const fullName = repo.fullName.toLowerCase()

  let bonus = 0
  for (const subscription of subscriptions) {
    if (subscription.kind === 'topic' && topics.has(subscription.value)) bonus += 0.07
    else if (subscription.kind === 'language' && language === subscription.value.toLowerCase()) bonus += 0.04
    else if (subscription.kind === 'author' && owner === subscription.value.toLowerCase()) bonus += 0.1
    else if (subscription.kind === 'release' && fullName === subscription.value.toLowerCase()) bonus += 0.05
  }

  return round(Math.min(0.2, bonus), 4)
}
