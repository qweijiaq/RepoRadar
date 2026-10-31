import {
  ensureUser as coreEnsureUser,
  findUserById as coreFindUserById,
  savePrefs as coreSavePrefs,
  type UserPrefs,
  type UserRecord,
} from '@repo-radar/core'
import { getPool } from './db'

export type { UserPrefs, UserRecord }

export async function ensureUser(input: {
  login: string
  displayName: string | null
  avatarUrl: string | null
  githubId: number | null
  email?: string | null
}): Promise<number> {
  return coreEnsureUser(getPool(), input)
}

export async function findUserById(id: number): Promise<UserRecord | null> {
  return coreFindUserById(getPool(), id)
}

export async function savePrefs(userId: number, prefs: UserPrefs): Promise<void> {
  return coreSavePrefs(getPool(), userId, prefs)
}
