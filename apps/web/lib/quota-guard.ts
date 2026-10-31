import { assertAiQuota, isQuotaError, type DbPool } from '@repo-radar/core'
import { redirect } from 'next/navigation'

/**
 * 旧的同步 AI action 也走同一套配额；被拒绝时跳到任务中心并显示原因。
 */
export async function guardAiQuota(pool: DbPool, userId: number): Promise<void> {
  try {
    await assertAiQuota(pool, userId)
  } catch (error) {
    if (isQuotaError(error)) redirect(`/tasks?quota=${encodeURIComponent(error.message)}`)
    throw error
  }
}
