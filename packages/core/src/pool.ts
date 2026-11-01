import { createPool, type DbPool } from './db.js'

const globalForDb = globalThis as unknown as { radarPool?: DbPool }

/**
 * Web 和 worker 共用的连接池单例。放在 core 里是为了让 worker 不再依赖 apps/web。
 */
export function getPool(): DbPool {
  if (!globalForDb.radarPool) {
    const url = process.env.DATABASE_URL ?? 'postgres://radar:radar@localhost:5433/radar'
    globalForDb.radarPool = createPool(url)
  }
  return globalForDb.radarPool
}
