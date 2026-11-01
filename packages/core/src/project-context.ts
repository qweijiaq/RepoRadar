import { extractDependencies } from './dependencies.js'
import { findRepoByFullName } from './db.js'
import { githubApiBase, mapGitHubRepo, parseGitHubRepoPayload } from './github.js'
import type { IntegrationProjectInput } from './integrations.js'
import type { RepoInput } from './types.js'
import { getPool } from './pool.js'

const MANIFESTS = ['package.json', 'pyproject.toml', 'requirements.txt', 'go.mod', 'Cargo.toml']

function githubHeaders(token: string, accept = 'application/vnd.github+json'): Record<string, string> {
  return {
    accept,
    authorization: `Bearer ${token}`,
    'x-github-api-version': '2022-11-28',
    'user-agent': 'repo-radar',
  }
}

async function fetchRaw(path: string, token: string): Promise<string | null> {
  const response = await fetch(`${githubApiBase()}${path}`, {
    headers: githubHeaders(token, 'application/vnd.github.raw'),
  })
  if (!response.ok) return null
  return response.text()
}

export async function fetchGitHubRepo(fullName: string, token: string): Promise<RepoInput | null> {
  const response = await fetch(`${githubApiBase()}/repos/${fullName}`, {
    headers: githubHeaders(token),
  })
  if (!response.ok) return null
  const payload = parseGitHubRepoPayload(await response.json())
  return payload ? mapGitHubRepo(payload) : null
}

export async function loadProjectContext(fullName: string, token: string | null): Promise<IntegrationProjectInput> {
  const repo = await findRepoByFullName(getPool(), fullName)
  const context: IntegrationProjectInput = {
    repo: fullName,
    description: repo?.summary ?? repo?.description ?? '',
    language: repo?.language ?? null,
    topics: repo?.topics ?? [],
    dependencies: [],
    readme: null,
    manifestName: null,
    manifest: null,
    lockfileName: null,
    lockfile: null,
  }

  if (!token) return context

  if (context.topics.length === 0) {
    const remote = await fetchGitHubRepo(fullName, token).catch(() => null)
    if (remote) {
      context.description ||= remote.description ?? ''
      context.language ||= remote.language
      context.topics = remote.topics
    }
  }

  const readme = await fetchRaw(`/repos/${fullName}/readme`, token)
  let manifestName: string | null = null
  let manifest: string | null = null
  for (const name of MANIFESTS) {
    const content = await fetchRaw(`/repos/${fullName}/contents/${name}`, token)
    if (content) {
      manifestName = name
      manifest = content.slice(0, 20_000)
      break
    }
  }

  const lockCandidates =
    manifestName === 'package.json'
      ? ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']
      : manifestName === 'requirements.txt' || manifestName === 'pyproject.toml'
        ? ['poetry.lock', 'uv.lock']
        : manifestName === 'go.mod'
          ? ['go.sum']
          : manifestName === 'Cargo.toml'
            ? ['Cargo.lock']
            : []
  let lockfileName: string | null = null
  let lockfile: string | null = null
  for (const name of lockCandidates) {
    const content = await fetchRaw(`/repos/${fullName}/contents/${name}`, token)
    if (content) {
      lockfileName = name
      lockfile = content.slice(0, 200_000)
      break
    }
  }

  return {
    ...context,
    dependencies: manifestName && manifest ? extractDependencies(manifestName, manifest) : [],
    readme: readme ? readme.slice(0, 6000) : null,
    manifestName,
    manifest,
    lockfileName,
    lockfile,
  }
}
