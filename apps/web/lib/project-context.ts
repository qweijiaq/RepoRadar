import {
  extractDependencies,
  findRepoByFullName,
  githubApiBase,
  mapGitHubRepo,
  type IntegrationProjectInput,
  type RepoInput,
} from '@repo-radar/core'
import { getPool } from './db'

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
    cache: 'no-store',
  })
  if (!response.ok) return null
  return response.text()
}

export async function fetchGitHubRepo(fullName: string, token: string): Promise<RepoInput | null> {
  const response = await fetch(`${githubApiBase()}/repos/${fullName}`, {
    headers: githubHeaders(token),
    cache: 'no-store',
  })
  if (!response.ok) return null
  return mapGitHubRepo((await response.json()) as Parameters<typeof mapGitHubRepo>[0])
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
