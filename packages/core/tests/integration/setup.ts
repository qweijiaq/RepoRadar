import pg from 'pg'
import { migrate, type DbPool } from '../../src/db.js'
import type { RepoInput } from '../../src/types.js'

const { Pool } = pg

/**
 * 集成测试单独使用一个 schema，避免误删开发库里的数据。
 * 需要 TEST_DATABASE_URL 指向一个可建 schema 的数据库（CI 里的 postgres service）。
 */
export const SCHEMA = 'radar_integration'

const databaseUrl = process.env.TEST_DATABASE_URL?.trim() || null

export const hasTestDatabase = databaseUrl !== null

export async function createTestPool(): Promise<DbPool> {
  if (!databaseUrl) throw new Error('TEST_DATABASE_URL 未设置')
  const admin = new Pool({ connectionString: databaseUrl, max: 1 })
  try {
    // 扩展装在 public，避免 drop schema 时连带删掉 vector 类型。
    await admin.query('CREATE EXTENSION IF NOT EXISTS vector')
    await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
    await admin.query(`CREATE SCHEMA ${SCHEMA}`)
  } finally {
    await admin.end()
  }
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 4,
    options: `-c search_path=${SCHEMA},public`,
  })
  await migrate(pool)
  return pool
}

export async function truncateAll(pool: DbPool): Promise<void> {
  const { rows } = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables
     WHERE schemaname = $1 AND tablename <> 'schema_migrations'`,
    [SCHEMA],
  )
  if (rows.length === 0) return
  const tables = rows.map((row) => `"${row.tablename}"`).join(', ')
  await pool.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`)
}

/** 测试结束后清掉临时 schema，开发库里不留垃圾。 */
export async function dropTestDatabase(): Promise<void> {
  if (!databaseUrl) return
  const admin = new Pool({ connectionString: databaseUrl, max: 1 })
  try {
    await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
  } finally {
    await admin.end()
  }
}

export function repoInput(overrides: Partial<RepoInput> = {}): RepoInput {
  const fullName = overrides.fullName ?? 'acme/radar'
  const [owner, name] = fullName.split('/')
  return {
    githubId: null,
    fullName,
    owner: owner ?? 'acme',
    name: name ?? 'radar',
    description: '一个用于测试的仓库',
    htmlUrl: `https://github.com/${fullName}`,
    homepage: null,
    language: 'TypeScript',
    topics: ['ai-agents'],
    stars: 100,
    forks: 5,
    openIssues: 1,
    license: 'MIT',
    archived: false,
    isFork: false,
    pushedAt: null,
    createdAt: null,
    ...overrides,
  }
}

/** pgvector 列固定 1536 维，测试里也按这个维度造数据。 */
export function embedding(seed: number): number[] {
  return Array.from({ length: 1536 }, (_, index) => ((index + seed) % 97) / 97)
}
