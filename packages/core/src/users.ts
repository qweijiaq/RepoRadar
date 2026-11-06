import type { DbPool } from './db.js'
import type { TasteProfile } from './personalize.js'
import { isRadarMode, type RadarMode } from './radar.js'

export type NotificationCategory =
  | 'githubStar'
  | 'githubFork'
  | 'githubIssue'
  | 'githubPull'
  | 'githubRelease'
  | 'release'
  | 'ai'
  | 'system'

export const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
  'githubStar',
  'githubFork',
  'githubIssue',
  'githubPull',
  'githubRelease',
  'release',
  'ai',
  'system',
]

export interface NotificationPrefs {
  githubStar: boolean
  githubFork: boolean
  githubIssue: boolean
  githubPull: boolean
  githubRelease: boolean
  emailNotifications: boolean
  pushNotifications: boolean
  weeklyDigest: boolean
  /** 为空表示沿用旧行为：总开关打开时所有类别都投递。 */
  emailKinds?: NotificationCategory[]
  pushKinds?: NotificationCategory[]
}

const AI_NOTIFICATION_KINDS = new Set([
  'job',
  'integration',
  'maintainer',
  'issue',
  'discoverability',
  'comparison',
  'issue-plan',
  'watch',
  'similar',
])

/** 把具体通知 kind 映射成用户可配置的类别。 */
export function notificationCategory(kind: string): NotificationCategory {
  if (kind === 'github-star') return 'githubStar'
  if (kind === 'github-fork') return 'githubFork'
  if (kind === 'github-issue') return 'githubIssue'
  if (kind === 'github-pr') return 'githubPull'
  if (kind === 'github-release') return 'githubRelease'
  if (kind === 'release') return 'release'
  if (AI_NOTIFICATION_KINDS.has(kind)) return 'ai'
  return 'system'
}

export function isNotificationCategory(value: string): value is NotificationCategory {
  return (NOTIFICATION_CATEGORIES as string[]).includes(value)
}

export function notificationChannelEnabled(
  prefs: NotificationPrefs,
  category: NotificationCategory,
  channel: 'email' | 'push',
): boolean {
  const master = channel === 'email' ? prefs.emailNotifications : prefs.pushNotifications
  if (!master) return false
  const kinds = channel === 'email' ? prefs.emailKinds : prefs.pushKinds
  return !kinds || kinds.includes(category)
}

export interface UserPrefs {
  excludedTopics: string[]
  excludedLanguages: string[]
  radarMode?: RadarMode
  notificationPrefs?: NotificationPrefs
  /** 页面里单独设置的通知邮箱；留空时回退到 GitHub 邮箱 */
  notificationEmail?: string | null
  /** 新手引导卡片是否已隐藏 */
  onboardingDismissed?: boolean
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  githubStar: true,
  githubFork: true,
  githubIssue: true,
  githubPull: true,
  githubRelease: true,
  emailNotifications: false,
  pushNotifications: false,
  weeklyDigest: false,
}

export interface UserRecord {
  id: number
  login: string
  displayName: string | null
  email: string | null
  avatarUrl: string | null
  profile: TasteProfile | null
  prefs: UserPrefs
  starsSyncedAt: string | null
}

interface UserRow {
  id: string
  login: string
  name: string | null
  email: string | null
  avatar_url: string | null
  profile: TasteProfile | null
  prefs: Partial<UserPrefs> | null
  stars_synced_at: Date | string | null
}

const DEFAULT_PREFS: UserPrefs = {
  excludedTopics: [],
  excludedLanguages: [],
  radarMode: 'balanced',
  notificationPrefs: DEFAULT_NOTIFICATION_PREFS,
}

function toIso(value: Date | string | null): string | null {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : value
}

function mapUser(row: UserRow): UserRecord {
  return {
    id: Number(row.id),
    login: row.login,
    displayName: row.name,
    email: row.email,
    avatarUrl: row.avatar_url,
    profile: row.profile,
    prefs: {
      excludedTopics: row.prefs?.excludedTopics ?? DEFAULT_PREFS.excludedTopics,
      excludedLanguages: row.prefs?.excludedLanguages ?? DEFAULT_PREFS.excludedLanguages,
      radarMode: isRadarMode(row.prefs?.radarMode) ? row.prefs.radarMode : 'balanced',
      notificationPrefs: {
        ...DEFAULT_NOTIFICATION_PREFS,
        ...(row.prefs?.notificationPrefs ?? {}),
      },
      notificationEmail: row.prefs?.notificationEmail?.trim() || null,
      onboardingDismissed: row.prefs?.onboardingDismissed === true,
    },
    starsSyncedAt: toIso(row.stars_synced_at),
  }
}

export interface EnsureUserInput {
  login: string
  displayName: string | null
  avatarUrl: string | null
  githubId: number | null
  email?: string | null
}

export async function ensureUser(pool: DbPool, input: EnsureUserInput): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (login, github_id, name, email, avatar_url)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (login) DO UPDATE SET
       name = COALESCE(EXCLUDED.name, users.name),
       email = COALESCE(EXCLUDED.email, users.email),
       avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url),
       github_id = COALESCE(EXCLUDED.github_id, users.github_id),
       updated_at = now()
     RETURNING id`,
    [input.login, input.githubId, input.displayName, input.email ?? null, input.avatarUrl],
  )
  const row = rows[0]
  if (!row) throw new Error('创建用户失败')
  return Number(row.id)
}

export async function findUserById(pool: DbPool, id: number): Promise<UserRecord | null> {
  const { rows } = await pool.query<UserRow>(`SELECT * FROM users WHERE id = $1 LIMIT 1`, [id])
  const row = rows[0]
  return row ? mapUser(row) : null
}

export async function findUserByLogin(pool: DbPool, login: string): Promise<UserRecord | null> {
  const { rows } = await pool.query<UserRow>(`SELECT * FROM users WHERE login = $1 LIMIT 1`, [login])
  const row = rows[0]
  return row ? mapUser(row) : null
}

export async function listUsersWithProfiles(pool: DbPool): Promise<UserRecord[]> {
  const { rows } = await pool.query<UserRow>(`SELECT * FROM users WHERE profile IS NOT NULL ORDER BY id`)
  return rows.map(mapUser)
}

export async function dismissOnboarding(pool: DbPool, userId: number): Promise<void> {
  await pool.query(
    `UPDATE users SET prefs = COALESCE(prefs, '{}'::jsonb) || jsonb_build_object('onboardingDismissed', true), updated_at = now() WHERE id = $1`,
    [userId],
  )
}

export async function savePrefs(pool: DbPool, userId: number, prefs: UserPrefs): Promise<void> {
  await pool.query(
    `UPDATE users SET prefs = COALESCE(prefs, '{}'::jsonb) || $2::jsonb, updated_at = now() WHERE id = $1`,
    [userId, JSON.stringify(prefs)],
  )
}

export function resolveNotificationEmail(user: UserRecord | null): string | null {
  if (!user) return null
  return user.prefs.notificationEmail?.trim() || user.email?.trim() || null
}

export async function saveNotificationEmail(
  pool: DbPool,
  userId: number,
  email: string | null,
): Promise<void> {
  if (!email) {
    await pool.query(`UPDATE users SET prefs = prefs - 'notificationEmail', updated_at = now() WHERE id = $1`, [userId])
    return
  }
  await pool.query(
    `UPDATE users SET prefs = COALESCE(prefs, '{}'::jsonb) ||
       jsonb_build_object('notificationEmail', $2::text), updated_at = now()
     WHERE id = $1`,
    [userId, email],
  )
}

export async function loadNotificationPrefs(pool: DbPool, userId: number): Promise<NotificationPrefs> {
  const user = await findUserById(pool, userId)
  return user?.prefs.notificationPrefs ?? DEFAULT_NOTIFICATION_PREFS
}

export async function saveNotificationPrefs(
  pool: DbPool,
  userId: number,
  prefs: NotificationPrefs,
): Promise<void> {
  await pool.query(
    `UPDATE users SET prefs = COALESCE(prefs, '{}'::jsonb) ||
       jsonb_build_object('notificationPrefs', $2::jsonb), updated_at = now()
     WHERE id = $1`,
    [userId, JSON.stringify(prefs)],
  )
}

export async function saveRadarMode(pool: DbPool, userId: number, mode: RadarMode): Promise<void> {
  await pool.query(
    `UPDATE users SET prefs = COALESCE(prefs, '{}'::jsonb) || jsonb_build_object('radarMode', $2::text),
       updated_at = now()
     WHERE id = $1`,
    [userId, mode],
  )
}

export async function loadUserStars(pool: DbPool, userId: number): Promise<Set<string>> {
  const { rows } = await pool.query<{ repo_full_name: string }>(
    `SELECT repo_full_name FROM user_stars WHERE user_id = $1`,
    [userId],
  )
  return new Set(rows.map((row) => row.repo_full_name))
}

export async function getInboxSeenAt(pool: DbPool, userId: number): Promise<string | null> {
  const { rows } = await pool.query<{ inbox_seen_at: Date | string | null }>(
    `SELECT inbox_seen_at FROM users WHERE id = $1`,
    [userId],
  )
  return toIso(rows[0]?.inbox_seen_at ?? null)
}

export async function markInboxSeen(pool: DbPool, userId: number): Promise<void> {
  await pool.query(`UPDATE users SET inbox_seen_at = now(), updated_at = now() WHERE id = $1`, [userId])
}
