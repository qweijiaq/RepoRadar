import { hostname } from 'node:os'
import { fileURLToPath } from 'node:url'
import {
  buildWeeklyDigest,
  createPool,
  enqueueWeeklyDigest,
  fetchLatestRelease,
  findUserByLogin,
  getAuthenticatedLogin,
  hasAuthSecret,
  hasReleaseEvents,
  listPendingDeliveries,
  listQueuedJobs,
  listReleaseWatchRepos,
  listUserGithubTokens,
  listUsersWithProfiles,
  loadConfig,
  markDeliveryFailed,
  markDeliverySent,
  notifyReleaseSubscribers,
  recoverStaleJobs,
  resolveBaseUrl,
  resolveMailConfig,
  resolveNotificationEmail,
  saveReleaseEvent,
  syncRepoActivity,
} from '@repo-radar/core'
import { executeJob } from '../lib/ai-jobs/runner'
import { sendMail } from '../lib/mailer'
import { sendPushToUser } from '../lib/push'

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
const ACTIVITY_INTERVAL = 15 * 60 * 1000
const RELEASE_INTERVAL = 15 * 60 * 1000
const DIGEST_INTERVAL = 30 * 60 * 1000
const DELIVERY_INTERVAL = 5 * 1000
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
  let watched: string[] = []
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
        const digest = await buildWeeklyDigest(pool, user, { baseUrl: siteUrl, limit: 8 })
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
