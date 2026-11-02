import { hostname } from 'node:os'
import { fileURLToPath } from 'node:url'
import {
  alertRecipients,
  checkIntegrationImpacts,
  buildWeeklyDigest,
  claimAlert,
  createPool,
  enqueueWeeklyDigest,
  evaluateAlerts,
  fetchLatestRelease,
  findUserByLogin,
  getAuthenticatedLogin,
  hasAuthSecret,
  hasReleaseEvents,
  listPendingDeliveries,
  listQueuedJobs,
  listReleaseWatchRepos,
  listUsersNeedingFeedSnapshot,
  listUserGithubTokens,
  listUsersWithProfiles,
  loadConfig,
  loadDiscoveryStatus,
  loadOpsConfig,
  loadStoredLlmConfig,
  buildTrendReport,
  loadTrendReport,
  logEvent,
  markDeliveryFailed,
  markDeliverySent,
  notifyReleaseSubscribers,
  recoverStaleJobs,
  refreshFeedSnapshot,
  resolveBaseUrl,
  resolveMailConfig,
  resolveNotificationEmail,
  runDiscovery,
  runRetentionIfDue,
  saveReleaseEvent,
  setSymbolSplitter,
  syncRepoActivity,
} from '@repo-radar/core'
import { sendMail, sendPushToUser } from '@repo-radar/core'
import { executeJob } from './ai-jobs/runner.js'
import { splitWithTreeSitter } from './code-symbols.js'

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)))
} catch {
  // 可选
}
try {
  process.loadEnvFile(fileURLToPath(new URL('../.env.local', import.meta.url)))
} catch {
  // 可选
}

if (process.env.NODE_ENV === 'production' && !hasAuthSecret()) {
  console.error('[worker] 生产环境缺少 AUTH_SECRET，拒绝启动。')
  process.exit(1)
}

const pool = createPool(loadConfig().databaseUrl)
const workerId = `${hostname()}:${process.pid}`
let stopping = false
let draining = false
let lastActivitySync = 0
let lastReleaseSync = 0
let lastDigestCheck = 0
let lastRetentionCheck = 0
let lastAlertCheck = 0
let lastDiscoveryCheck = 0
let discoveryRunning = false
let discoveryRetryAt = 0
const ACTIVITY_INTERVAL = 15 * 60 * 1000
const RELEASE_INTERVAL = 15 * 60 * 1000
const DIGEST_INTERVAL = 30 * 60 * 1000
const RETENTION_CHECK_INTERVAL = 30 * 60 * 1000
const ALERT_CHECK_INTERVAL = 5 * 60 * 1000
const DELIVERY_INTERVAL = 5 * 1000
const DISCOVERY_CHECK_INTERVAL = 10 * 60 * 1000
const DISCOVERY_INTERVAL = 6 * 60 * 60 * 1000
const DISCOVERY_LOCK_KEY = 728413
let lastDeliveryDrain = 0

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function scheduledActivity(): Promise<void> {
  if (Date.now() - lastActivitySync < ACTIVITY_INTERVAL) return
  lastActivitySync = Date.now()

  const stored = await listUserGithubTokens(pool)
  if (stored.length > 0) {
    for (const entry of stored) {
      if (stopping) break
      try {
        const result = await syncRepoActivity(pool, entry.userId, entry.login, entry.token, { maxProjects: 20 })
        console.log(`[worker] activity ${entry.login}: ${result.notifications} new`)
      } catch (error) {
        console.error(`[worker] activity ${entry.login} failed:`, error)
      }
      await sleep(300)
    }
    return
  }

  const token = loadConfig().githubToken
  if (!token) return
  try {
    const login = await getAuthenticatedLogin(token)
    if (!login) return
    const user = await findUserByLogin(pool, login)
    if (!user) return
    const result = await syncRepoActivity(pool, user.id, user.login, token, { maxProjects: 20 })
    console.log(`[worker] activity ${user.login}: ${result.notifications} new`)
  } catch (error) {
    console.error('[worker] activity sync failed:', error)
  }
}

async function scheduledReleases(): Promise<void> {
  if (Date.now() - lastReleaseSync < RELEASE_INTERVAL) return
  lastReleaseSync = Date.now()
  let watched: string[]
  try {
    watched = await listReleaseWatchRepos(pool)
  } catch (error) {
    console.error('[worker] release list failed:', error)
    return
  }
  if (watched.length === 0) return
  const token = loadConfig().githubToken ?? undefined
  let checked = 0
  let fresh = 0
  for (const fullName of watched) {
    if (stopping) break
    try {
      const known = await hasReleaseEvents(pool, fullName)
      const release = await fetchLatestRelease(fullName, token)
      checked += 1
      if (!release) continue
      const isNew = await saveReleaseEvent(pool, { repoFullName: fullName, ...release })
      if (isNew && known) {
        await notifyReleaseSubscribers(pool, { repoFullName: fullName, ...release })
        fresh += 1
      }
    } catch (error) {
      console.error(`[worker] release ${fullName} failed:`, error)
    }
    await sleep(300)
  }
  if (checked > 0) console.log(`[worker] releases checked ${checked}, new ${fresh}`)
}

async function scheduledWeeklyDigest(): Promise<void> {
  if (Date.now() - lastDigestCheck < DIGEST_INTERVAL) return
  lastDigestCheck = Date.now()
  try {
    const users = await listUsersWithProfiles(pool)
    for (const user of users) {
      if (stopping) break
      if (!user.prefs.notificationPrefs?.weeklyDigest) continue
      if (!resolveNotificationEmail(user)) continue
      try {
        const siteUrl = await resolveBaseUrl(pool)
        const digest = await buildWeeklyDigest(pool, user, { baseUrl: siteUrl, limit: 10 })
        if (digest.items.length === 0) continue
        const queued = await enqueueWeeklyDigest(pool, {
          userId: user.id,
          login: user.login,
          subject: digest.subject,
          text: digest.text,
          html: digest.html,
          baseUrl: siteUrl,
        })
        if (queued) console.log(`[worker] weekly digest queued for ${user.login}`)
      } catch (error) {
        console.error(`[worker] digest ${user.login} failed:`, error)
      }
    }
  } catch (error) {
    console.error('[worker] digest scan failed:', error)
  }
}

async function runScheduledDiscovery(): Promise<void> {
  // advisory lock 是连接级的，必须和 unlock 使用同一个连接。
  const client = await pool.connect()
  try {
    const lock = await client.query<{ locked: boolean }>('select pg_try_advisory_lock($1) as locked', [
      DISCOVERY_LOCK_KEY,
    ])
    if (!lock.rows[0]?.locked) return
    try {
      const status = await loadDiscoveryStatus(pool)
      if (status.lastRun && Date.now() - new Date(status.lastRun.at).getTime() < DISCOVERY_INTERVAL) return
      const config = loadConfig()
      const topics = config.search.topics
      if (topics.length === 0) return
      const llm = config.llm ?? (await loadStoredLlmConfig(pool))
      const stored = await listUserGithubTokens(pool)
      const token = stored[0]?.token ?? config.githubToken ?? null
      console.log(`[worker] discovery starting: ${topics.length} topics`)
      const enrichLimit = status.enrichedRepos < 100 ? 50 : 20
      const run = await runDiscovery(pool, {
        topics,
        token,
        llm,
        pages: 1,
        perPage: 30,
        enrichLimit,
        delayMs: 2200,
        sort: 'updated',
        freshDays: 120,
      })
      console.log(`[worker] discovery inserted ${run.inserted}, enriched ${run.enriched}`)
      logEvent('info', 'discovery.auto', { inserted: run.inserted, enriched: run.enriched, topics })
    } catch (error) {
      discoveryRetryAt = Date.now() + 30 * 60 * 1000
      logEvent('error', 'discovery.auto_failed', {
        error: error instanceof Error ? error.message : String(error),
      })
      console.error('[worker] discovery failed:', error)
    } finally {
      await client.query('select pg_advisory_unlock($1)', [DISCOVERY_LOCK_KEY])
    }
  } finally {
    client.release()
  }
}

async function scheduledDiscovery(): Promise<void> {
  if (discoveryRunning) return
  if (Date.now() < discoveryRetryAt) return
  if (Date.now() - lastDiscoveryCheck < DISCOVERY_CHECK_INTERVAL) return
  lastDiscoveryCheck = Date.now()
  if (process.env.DISCOVERY_AUTO === 'off') return
  try {
    const status = await loadDiscoveryStatus(pool)
    if (status.lastRun && Date.now() - new Date(status.lastRun.at).getTime() < DISCOVERY_INTERVAL) return
    discoveryRunning = true
    void runScheduledDiscovery().finally(() => {
      discoveryRunning = false
    })
  } catch (error) {
    console.error('[worker] discovery check failed:', error)
  }
}

async function scheduledRetention(): Promise<void> {
  if (Date.now() - lastRetentionCheck < RETENTION_CHECK_INTERVAL) return
  lastRetentionCheck = Date.now()
  try {
    const counts = await runRetentionIfDue(pool)
    if (counts) console.log(`[worker] retention cleaned ${counts.total} rows`)
  } catch (error) {
    console.error('[worker] retention cleanup failed:', error)
  }
}

const FEED_SNAPSHOT_INTERVAL = 30 * 60 * 1000
let lastFeedSnapshotAt = 0

/** 定期为用户预计算 feed 主列表快照，页面就不用每次排名 500 条。 */
async function scheduledFeedSnapshots(): Promise<void> {
  if (Date.now() - lastFeedSnapshotAt < FEED_SNAPSHOT_INTERVAL) return
  lastFeedSnapshotAt = Date.now()
  try {
    const userIds = await listUsersNeedingFeedSnapshot(pool, 20)
    for (const id of userIds) {
      if (stopping) break
      const snapshot = await refreshFeedSnapshot(pool, id)
      if (snapshot) console.log(`[worker] feed snapshot #${id}: ${snapshot.ids.length} items`)
    }
  } catch (error) {
    console.error('[worker] feed snapshot failed:', error)
  }
}

const IMPACT_INTERVAL = 6 * 60 * 60 * 1000
let lastImpactCheckAt = 0

/** 已接入的库发新版本时，写一条回访并通知用户。 */
async function scheduledTrendBrief(): Promise<void> {
  const latest = await loadTrendReport(pool)
  if (latest && Date.now() - Date.parse(latest.generatedAt) < 12 * 60 * 60 * 1000) return
  const llm = loadConfig().llm ?? (await loadStoredLlmConfig(pool).catch(() => null))
  if (!llm) return
  try {
    await buildTrendReport(pool, llm)
    console.log('[worker] 趋势简报已更新')
  } catch (error) {
    console.error('[worker] 趋势简报生成失败：', error)
  }
}

async function scheduledIntegrationImpacts(): Promise<void> {
  if (Date.now() - lastImpactCheckAt < IMPACT_INTERVAL) return
  lastImpactCheckAt = Date.now()
  try {
    const created = await checkIntegrationImpacts(pool, {
      token: loadConfig().githubToken ?? undefined,
      limit: 25,
    })
    if (created > 0) console.log(`[worker] integration impacts: ${created}`)
  } catch (error) {
    console.error('[worker] integration impact check failed:', error)
  }
}

async function scheduledAlerts(): Promise<void> {
  if (Date.now() - lastAlertCheck < ALERT_CHECK_INTERVAL) return
  lastAlertCheck = Date.now()
  try {
    const config = await loadOpsConfig(pool)
    if (!config.alertsEnabled) return
    const alerts = await evaluateAlerts(pool)
    if (alerts.length === 0) return
    const recipients = await alertRecipients(pool)
    if (recipients.length === 0) {
      logEvent('warn', 'alert.no_recipients', { count: alerts.length })
      return
    }
    const mail = await resolveMailConfig(pool)
    if (!mail) {
      logEvent('warn', 'alert.no_mail_channel', { count: alerts.length })
      return
    }
    for (const alert of alerts) {
      if (!(await claimAlert(pool, alert.key, config.cooldownMinutes))) continue
      for (const to of recipients) {
        try {
          await sendMail(mail, {
            to,
            subject: `[RepoRadar] ${alert.title}`,
            text: `${alert.body}

发生时间：${new Date().toLocaleString('zh-CN')}
运维面板：/ops
`,
          })
          logEvent('warn', 'alert.sent', { key: alert.key, recipient: to })
        } catch (error) {
          logEvent('error', 'alert.send_failed', {
            key: alert.key,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }
  } catch (error) {
    logEvent('error', 'alert.check_failed', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

async function drainDeliveries(): Promise<void> {
  if (draining || Date.now() - lastDeliveryDrain < DELIVERY_INTERVAL) return
  draining = true
  lastDeliveryDrain = Date.now()
  try {
    const deliveries = await listPendingDeliveries(pool, 10)
    const mail = deliveries.some((delivery) => delivery.channel === 'email')
      ? await resolveMailConfig(pool)
      : null
    for (const delivery of deliveries) {
      if (stopping) break
      try {
        if (delivery.channel === 'email') {
          if (!mail) throw new Error('还没有配置邮件通道')
          if (!delivery.email?.trim()) throw new Error('用户没有通知邮箱')
          await sendMail(mail, {
            to: delivery.email,
            subject: delivery.subject,
            text: delivery.body ?? delivery.subject,
            html: delivery.bodyHtml,
          })
        } else {
          await sendPushToUser(pool, delivery.userId, {
            title: delivery.subject,
            body: delivery.body,
            url: delivery.url,
          })
        }
        await markDeliverySent(pool, delivery.id)
        console.log(`[worker] delivered ${delivery.channel} #${delivery.id} to ${delivery.login}`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await markDeliveryFailed(pool, delivery.id, message)
        console.error(`[worker] delivery #${delivery.id} failed:`, message)
      }
    }
  } catch (error) {
    console.error('[worker] delivery drain failed:', error)
  } finally {
    draining = false
  }
}

// 代码索引优先用 tree-sitter，加载失败时 core 会自动退回启发式切块。
setSymbolSplitter(splitWithTreeSitter)

async function loop(): Promise<void> {
  console.log(`[worker] started ${workerId}`)
  while (!stopping) {
    try {
      await recoverStaleJobs(pool)
      const jobs = await listQueuedJobs(pool, 5)
      for (const job of jobs) {
        if (stopping) break
        await executeJob(pool, job.userId, job.id)
      }
      await drainDeliveries()
      await scheduledActivity()
      await scheduledReleases()
      await scheduledWeeklyDigest()
      await scheduledDiscovery()
      await scheduledRetention()
      await scheduledFeedSnapshots()
      await scheduledIntegrationImpacts()
      await scheduledTrendBrief()
      await scheduledAlerts()
    } catch (error) {
      console.error('[worker] loop error:', error)
    }
    await sleep(2000)
  }
}

process.on('SIGINT', () => {
  stopping = true
})
process.on('SIGTERM', () => {
  stopping = true
})

void loop().finally(async () => {
  await pool.end()
  console.log('[worker] stopped')
})
