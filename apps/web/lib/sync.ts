import {
  buildTasteProfile,
  mapGitHubRepo,
  parseGitHubRepoPayload,
  parseVector,
  saveSnapshot,
  sleep,
  upsertRepo,
  upsertUserProject,
  type RepoInput,
  type StarredSignal,
  type TasteProfile,
  getPool,
} from '@repo-radar/core'

const MAX_STARS = 200
const MAX_EVENT_REPO_LOOKUPS = 8
const DAY_MS = 86_400_000

interface StarredItem {
  repo: RepoInput
  starredAt: string | null
}

interface SignalEntry {
  source: 'star' | 'owned' | 'event'
  weight: number
}

function githubHeaders(token: string, accept = 'application/vnd.github+json'): Record<string, string> {
  return {
    accept,
    authorization: `Bearer ${token}`,
    'x-github-api-version': '2022-11-28',
    'user-agent': 'repo-radar',
  }
}

async function fetchStarredRepos(token: string): Promise<StarredItem[]> {
  const items: StarredItem[] = []

  for (let page = 1; items.length < MAX_STARS; page++) {
    const response = await fetch(`https://api.github.com/user/starred?per_page=100&page=${page}`, {
      headers: githubHeaders(token, 'application/vnd.github.star+json'),
      cache: 'no-store',
    })
    if (!response.ok) throw new Error(`GitHub starred API 返回 ${response.status}`)

    const data: unknown = await response.json()
    if (!Array.isArray(data) || data.length === 0) break

    for (const entry of data) {
      if (items.length >= MAX_STARS) break
      const wrapped =
        typeof entry === 'object' && entry !== null && 'repo' in entry
          ? (entry as { repo: unknown; starred_at?: string })
          : { repo: entry, starred_at: undefined }
      const payload = parseGitHubRepoPayload(wrapped.repo)
      if (!payload) continue
      items.push({ repo: mapGitHubRepo(payload), starredAt: wrapped.starred_at ?? null })
    }
    if (data.length < 100) break
  }

  return items
}

async function fetchOwnedRepos(login: string, token: string): Promise<RepoInput[]> {
  const response = await fetch(
    `https://api.github.com/users/${login}/repos?sort=pushed&direction=desc&per_page=100&type=owner`,
    { headers: githubHeaders(token), cache: 'no-store' },
  )
  if (!response.ok) return []
  const data: unknown = await response.json()
  if (!Array.isArray(data)) return []
  const repos: RepoInput[] = []
  for (const item of data) {
    const payload = parseGitHubRepoPayload(item)
    if (payload && !payload.fork && !payload.archived) repos.push(mapGitHubRepo(payload))
  }
  return repos
}

interface PublicEvent {
  type?: string
  repo?: { name?: string }
  created_at?: string
}

async function fetchEventRepos(login: string, token: string): Promise<Array<{ fullName: string; createdAt: string }>> {
  const response = await fetch(`https://api.github.com/users/${login}/events/public?per_page=100`, {
    headers: githubHeaders(token),
    cache: 'no-store',
  })
  if (!response.ok) return []
  const events = (await response.json()) as PublicEvent[]
  if (!Array.isArray(events)) return []

  const interesting = new Set(['PushEvent', 'PullRequestEvent', 'IssuesEvent', 'CreateEvent', 'ReleaseEvent'])
  const repos = new Map<string, string>()
  for (const event of events) {
    if (!event.type || !interesting.has(event.type) || !event.repo?.name) continue
    if (!repos.has(event.repo.name)) {
      repos.set(event.repo.name, event.created_at ?? new Date().toISOString())
    }
  }
  return [...repos.entries()].map(([fullName, createdAt]) => ({ fullName, createdAt }))
}

async function fetchRepoMetadata(fullName: string, token: string): Promise<RepoInput | null> {
  const response = await fetch(`https://api.github.com/repos/${fullName}`, {
    headers: githubHeaders(token),
    cache: 'no-store',
  })
  if (!response.ok) return null
  const payload = parseGitHubRepoPayload(await response.json())
  return payload ? mapGitHubRepo(payload) : null
}

function starWeight(starredAt: string | null, now: number): number {
  if (!starredAt) return 1
  const age = (now - Date.parse(starredAt)) / DAY_MS
  if (!Number.isFinite(age)) return 1
  if (age <= 90) return 3
  if (age <= 365) return 1.5
  return 0.3
}

function activityWeight(timestamp: string | null, now: number): number {
  if (!timestamp) return 0.5
  const age = (now - Date.parse(timestamp)) / DAY_MS
  if (!Number.isFinite(age)) return 0.5
  if (age <= 90) return 3
  if (age <= 365) return 1.5
  return 0.5
}

/**
 * 用「最近 star + 自己维护的仓库 + 近期公开事件」建立口味画像。
 * 近期行为权重更高，避免几年前的 star 主导推荐。
 */
export async function syncUserTaste(userId: number, login: string, token: string): Promise<number> {
  const pool = getPool()
  const now = Date.now()

  const starred = await fetchStarredRepos(token)
  const owned = await fetchOwnedRepos(login, token).catch(() => [])
  const eventRepos = await fetchEventRepos(login, token).catch(() => [])

  const repoByFullName = new Map<string, RepoInput>()
  const signals = new Map<string, SignalEntry[]>()

  function addSignal(repo: RepoInput, source: SignalEntry['source'], weight: number) {
    repoByFullName.set(repo.fullName, repo)
    const entries = signals.get(repo.fullName) ?? []
    entries.push({ source, weight })
    signals.set(repo.fullName, entries)
  }

  for (const item of starred) addSignal(item.repo, 'star', starWeight(item.starredAt, now))
  for (const repo of owned) addSignal(repo, 'owned', activityWeight(repo.pushedAt, now))

  let lookups = 0
  for (const eventRepo of eventRepos) {
    let repo = repoByFullName.get(eventRepo.fullName)
    if (!repo && lookups < MAX_EVENT_REPO_LOOKUPS) {
      lookups++
      repo = (await fetchRepoMetadata(eventRepo.fullName, token)) ?? undefined
      if (repo) await sleep(200)
    }
    if (repo) addSignal(repo, 'event', 2.5)
  }

  const starNames = new Set(starred.map((item) => item.repo.fullName))
  for (const repo of repoByFullName.values()) {
    const { id } = await upsertRepo(pool, repo)
    if (starNames.has(repo.fullName)) await saveSnapshot(pool, id, repo.stars)
  }

  for (const repo of owned) {
    const active = repo.pushedAt ? now - Date.parse(repo.pushedAt) <= 180 * DAY_MS : true
    await upsertUserProject(pool, userId, repo.fullName, {
      source: 'owned',
      active,
      lastPushedAt: repo.pushedAt,
    })
  }

  for (const item of starred) {
    await pool.query(
      `INSERT INTO user_stars (user_id, repo_full_name, starred_at) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, repo_full_name) DO UPDATE SET starred_at = COALESCE(EXCLUDED.starred_at, user_stars.starred_at)`,
      [userId, item.repo.fullName, item.starredAt],
    )
  }

  if (starred.length > 0) {
    await pool.query(`DELETE FROM user_stars WHERE user_id = $1 AND NOT (repo_full_name = ANY($2::text[]))`, [
      userId,
      starred.map((item) => item.repo.fullName),
    ])
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`DELETE FROM user_signals WHERE user_id = $1`, [userId])
    for (const [fullName, entries] of signals) {
      for (const entry of entries) {
        await client.query(
          `INSERT INTO user_signals (user_id, repo_full_name, source, weight, seen_at)
           VALUES ($1, $2, $3, $4, now())
           ON CONFLICT (user_id, repo_full_name, source) DO UPDATE SET weight = EXCLUDED.weight, seen_at = now()`,
          [userId, fullName, entry.source, entry.weight],
        )
      }
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }

  await rebuildProfile(userId)
  return starred.length
}

interface SignalRow {
  topics: string[] | null
  language: string | null
  embedding: string | null
  weight: number
  source: 'star' | 'owned' | 'event'
  prefs: { excludedTopics?: string[]; excludedLanguages?: string[] } | null
}

interface LegacySignalRow {
  topics: string[] | null
  language: string | null
  embedding: string | null
  prefs: { excludedTopics?: string[]; excludedLanguages?: string[] } | null
}

export async function rebuildProfile(userId: number): Promise<TasteProfile> {
  const pool = getPool()
  const { rows } = await pool.query<SignalRow>(
    `SELECT r.topics, r.language, r.embedding::text AS embedding, s.weight, s.source, u.prefs
     FROM user_signals s
     JOIN repos r ON r.full_name = s.repo_full_name
     JOIN users u ON u.id = s.user_id
     WHERE s.user_id = $1`,
    [userId],
  )

  let signals: StarredSignal[]
  let prefs: { excludedTopics?: string[]; excludedLanguages?: string[] }

  if (rows.length > 0) {
    signals = rows.map((row) => ({
      topics: row.topics ?? [],
      language: row.language,
      embedding: parseVector(row.embedding),
      weight: row.weight,
      source: row.source,
    }))
    prefs = rows[0]?.prefs ?? {}
  } else {
    // 兼容旧用户：还没有行为信号时，退回 star 列表建立画像
    const legacy = await pool.query<LegacySignalRow>(
      `SELECT r.topics, r.language, r.embedding::text AS embedding, u.prefs
       FROM user_stars s
       JOIN repos r ON r.full_name = s.repo_full_name
       JOIN users u ON u.id = s.user_id
       WHERE s.user_id = $1`,
      [userId],
    )
    signals = legacy.rows.map((row) => ({
      topics: row.topics ?? [],
      language: row.language,
      embedding: parseVector(row.embedding),
      weight: 1,
      source: 'star',
    }))
    prefs = legacy.rows[0]?.prefs ?? {}
  }

  const profile = buildTasteProfile({
    starred: signals,
    excludedTopics: prefs.excludedTopics ?? [],
    excludedLanguages: prefs.excludedLanguages ?? [],
  })

  const starredCount = await pool.query<{ count: string }>(`SELECT count(*) FROM user_stars WHERE user_id = $1`, [userId])
  profile.starredCount = Number(starredCount.rows[0]?.count ?? 0)

  await pool.query(`UPDATE users SET profile = $2, stars_synced_at = now(), updated_at = now() WHERE id = $1`, [
    userId,
    JSON.stringify(profile),
  ])
  return profile
}
