import type { LlmConfig } from './config.js'
import { loadConfig } from './config.js'
import type { DbPool } from './db.js'
import { loadDiscoveryStatus } from './discovery.js'
import { fetchTokenScopes } from './github.js'
import { listUserGithubTokens } from './github-tokens.js'
import { loadStoredLlmConfig } from './llm-config.js'
import { resolveMailConfig } from './mail-config.js'
import { getAuthenticatedLogin, hasDeleteRepoScope, hasRepoScope } from './repo-management.js'
import { resolveBaseUrlStatus } from './site-config.js'

export type DoctorLevel = 'ok' | 'warn' | 'error'

export interface DoctorCheck {
  id: string
  level: DoctorLevel
  title: string
  detail: string
}

export interface DoctorOptions {
  llm?: LlmConfig | null
}

function check(id: string, level: DoctorLevel, title: string, detail: string): DoctorCheck {
  return { id, level, title, detail }
}

export async function runDoctor(pool: DbPool, options: DoctorOptions = {}): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = []

  try {
    await pool.query('SELECT 1')
    checks.push(check('database', 'ok', '数据库连接', 'PostgreSQL 可以正常连接。'))
  } catch (error) {
    return [
      check(
        'database',
        'error',
        '数据库连接',
        `无法连接数据库：${error instanceof Error ? error.message : String(error)}`,
      ),
    ]
  }

  try {
    const { rows } = await pool.query<{ extname: string }>(
      `SELECT extname FROM pg_extension WHERE extname = 'vector'`,
    )
    checks.push(
      rows.length > 0
        ? check('pgvector', 'ok', 'pgvector', '向量扩展已启用。')
        : check('pgvector', 'warn', 'pgvector', '未启用 pgvector；依赖向量的能力会退化为文本匹配。'),
    )
  } catch (error) {
    checks.push(check('pgvector', 'warn', 'pgvector', `无法检查向量扩展：${String(error)}`))
  }

  try {
    const { rows } = await pool.query<{ count: string; latest: string | null }>(
      `SELECT count(*) AS count, max(version) AS latest FROM schema_migrations`,
    )
    checks.push(
      check(
        'migrations',
        'ok',
        '数据库迁移',
        `已应用 ${rows[0]?.count ?? 0} 个迁移${rows[0]?.latest ? `，最新 ${rows[0].latest}` : ''}。`,
      ),
    )
  } catch {
    checks.push(check('migrations', 'warn', '数据库迁移', '还没有迁移记录；请先运行数据库迁移。'))
  }

  try {
    const status = await loadDiscoveryStatus(pool)
    checks.push(
      status.totalRepos === 0
        ? check('candidate-pool', 'warn', '候选池', '候选池为空；先刷新候选池或运行采集。')
        : check(
            'candidate-pool',
            status.pendingRepos > Math.max(50, status.enrichedRepos * 5) ? 'warn' : 'ok',
            '候选池',
            `共 ${status.totalRepos} 个仓库，已富化 ${status.enrichedRepos}，待富化 ${status.pendingRepos}。`,
          ),
    )
  } catch (error) {
    checks.push(check('candidate-pool', 'warn', '候选池', `无法读取候选池：${String(error)}`))
  }

  let llm: LlmConfig | null = options.llm ?? loadConfig().llm ?? null
  if (!llm) {
    try {
      llm = await loadStoredLlmConfig(pool)
    } catch {
      llm = null
    }
  }
  checks.push(
    llm
      ? check(
          'llm',
          llm.embeddingModel?.trim() ? 'ok' : 'warn',
          'AI 模型',
          `${llm.providerId ?? '自定义'} · ${llm.model}；Embedding ${llm.embeddingModel?.trim() || '未配置（使用文本匹配）'}。`,
        )
      : check('llm', 'error', 'AI 模型', '还没有配置模型；周报、接入、相似对比等 AI 功能不可用。'),
  )

  try {
    const { rows } = await pool.query<{ total: string; embedded: string }>(
      `SELECT count(*) AS total, count(embedding) AS embedded FROM repos WHERE enriched_at IS NOT NULL`,
    )
    const total = Number(rows[0]?.total ?? 0)
    const embedded = Number(rows[0]?.embedded ?? 0)
    checks.push(
      check(
        'embedding-coverage',
        llm?.embeddingModel?.trim() && total > 0 && embedded === 0 ? 'warn' : 'ok',
        '语义向量',
        embedded > 0
          ? `${embedded} / ${total} 个已富化仓库有向量。`
          : llm?.embeddingModel?.trim()
            ? '已配置 Embedding 模型，但还没有生成向量；请确认服务商支持该模型，并重新富化。'
            : '未启用 Embedding，相似度和排序使用文本/关键词匹配。',
      ),
    )
  } catch (error) {
    checks.push(check('embedding-coverage', 'warn', '语义向量', `无法检查：${String(error)}`))
  }

  try {
    const stored = await listUserGithubTokens(pool)
    const envToken = loadConfig().githubToken
    const tokens = [
      ...stored.slice(0, 3).map((entry) => ({ login: entry.login, token: entry.token })),
      ...(envToken ? [{ login: 'GITHUB_TOKEN', token: envToken }] : []),
    ]
    if (tokens.length === 0) {
      checks.push(check('github', 'warn', 'GitHub 授权', '没有可用的 GitHub token；只能使用有限的公开采集。'))
    } else {
      for (const entry of tokens) {
        const [login, scopes] = await Promise.all([
          getAuthenticatedLogin(entry.token).catch(() => null),
          fetchTokenScopes(entry.token).catch(() => null),
        ])
        const scopeText = scopes ? scopes.join(' ') : ''
        const repo = hasRepoScope(scopeText)
        const del = hasDeleteRepoScope(scopeText)
        checks.push(
          check(
            `github:${entry.login}`,
            login ? (repo ? 'ok' : 'warn') : 'error',
            `GitHub 授权 · ${entry.login}`,
            login
              ? `登录有效；scope：${scopeText || '未知'}${repo ? '' : '；缺少 repo，私有仓库和管理功能不可用'}${del ? '；含 delete_repo' : ''}。`
              : 'token 无效或无法访问 GitHub；请重新登录。',
          ),
        )
      }
    }
  } catch (error) {
    checks.push(check('github', 'warn', 'GitHub 授权', `无法检查 token：${String(error)}`))
  }

  try {
    const [mail, site] = await Promise.all([resolveMailConfig(pool), resolveBaseUrlStatus(pool)])
    checks.push(
      mail
        ? check('mail', 'ok', '邮件通道', `已配置（${mail.host}:${mail.port}）。`)
        : check('mail', 'warn', '邮件通道', '未配置；站内通知仍可用，邮件不会发送。'),
    )
    checks.push(
      /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(site.url)
        ? check('site-url', 'warn', '站点地址', `当前为本地地址 ${site.url}；公网邮件链接需要设置公开地址。`)
        : check('site-url', 'ok', '站点地址', site.url),
    )
  } catch (error) {
    checks.push(check('mail', 'warn', '邮件与站点', `无法检查：${String(error)}`))
  }

  try {
    const { rows } = await pool.query<{
      queued: string
      running: string
      oldest_running: string | null
    }>(
      `SELECT count(*) FILTER (WHERE status = 'queued') AS queued,
              count(*) FILTER (WHERE status = 'running') AS running,
              min(heartbeat_at) FILTER (WHERE status = 'running') AS oldest_running
         FROM ai_jobs`,
    )
    const queued = Number(rows[0]?.queued ?? 0)
    const running = Number(rows[0]?.running ?? 0)
    const oldest = rows[0]?.oldest_running ? Date.parse(rows[0].oldest_running) : null
    const stale = oldest !== null && Date.now() - oldest > 10 * 60 * 1000
    checks.push(
      check(
        'jobs',
        queued > 20 || stale ? 'warn' : 'ok',
        '后台任务',
        `${queued} 个排队，${running} 个运行中${stale ? '；有任务心跳超过 10 分钟' : ''}。`,
      ),
    )
  } catch (error) {
    checks.push(check('jobs', 'warn', '后台任务', `无法读取任务队列：${String(error)}`))
  }

  return checks
}
