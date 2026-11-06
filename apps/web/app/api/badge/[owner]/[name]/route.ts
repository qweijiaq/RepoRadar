import { findRepoByFullName, getPool, loadVerifications } from '@repo-radar/core'

export const dynamic = 'force-dynamic'

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function badge(label: string, color: string, width = 250): string {
  const safeLabel = escapeXml(label)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="28" role="img" aria-label="RepoRadar: ${safeLabel}">
  <title>RepoRadar: ${safeLabel}</title>
  <clipPath id="r"><rect width="${width}" height="28" rx="5" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="92" height="28" fill="#1f2937"/>
    <rect x="92" width="${width - 92}" height="28" fill="${color}"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="46" y="18">RepoRadar</text>
    <text x="${92 + (width - 92) / 2}" y="18">${safeLabel}</text>
  </g>
</svg>`
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ owner: string; name: string }> },
): Promise<Response> {
  const { owner, name } = await context.params
  const fullName = `${owner}/${name}`
  const pool = getPool()
  const repo = await findRepoByFullName(pool, fullName)
  if (!repo) {
    return new Response(badge('unknown', '#6b7280'), {
      headers: { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'public, max-age=300' },
    })
  }

  const latest = (await loadVerifications(pool, fullName, 1))[0] ?? null
  const state = latest?.status
  const label =
    state === 'verified'
      ? 'verified'
      : state === 'failed'
        ? 'build failed'
        : state === 'error'
          ? 'error'
          : state === 'skipped'
            ? 'skipped'
            : 'not verified'
  const color =
    state === 'verified'
      ? '#2f9e68'
      : state === 'failed' || state === 'error'
        ? '#d9534f'
        : '#6b7280'

  return new Response(badge(label, color), {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  })
}
