import { createPool, type DbPool } from '@repo-radar/core'

const globalForDb = globalThis as unknown as { radarPool?: DbPool }

export function getPool(): DbPool {
  if (!globalForDb.radarPool) {
    const url = process.env.DATABASE_URL ?? 'postgres://radar:radar@localhost:5433/radar'
    globalForDb.radarPool = createPool(url)
  }
  return globalForDb.radarPool
}
