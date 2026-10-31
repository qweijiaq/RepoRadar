'use server'

import { isRadarMode, saveRadarSnapshot } from '@repo-radar/core'
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { getPool } from '@/lib/db'
import { sessionUser } from '@/lib/session'

interface RawSnapshot {
  mode?: unknown
  persona?: { name?: unknown; detail?: unknown }
  opportunities?: unknown
  gems?: unknown
}

function text(value: unknown, max = 240): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

export async function createRadarShareAction(formData: FormData): Promise<void> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')

  let raw: RawSnapshot
  try {
    raw = JSON.parse(String(formData.get('snapshot') ?? '{}')) as RawSnapshot
  } catch {
    redirect('/feed')
  }

  const requestedMode = typeof raw.mode === 'string' ? raw.mode : ''
  const mode = isRadarMode(requestedMode) ? requestedMode : 'balanced'
  const persona = {
    name: text(raw.persona?.name, 40) || '开源雷达观察员',
    detail: text(raw.persona?.detail, 120) || '持续寻找值得关注的项目',
  }
  const opportunities = Array.isArray(raw.opportunities)
    ? raw.opportunities.slice(0, 3).map((item) => {
        const entry = item as Record<string, unknown>
        return {
          kind: text(entry.kind, 24) || 'opportunity',
          title: text(entry.title, 160),
          detail: text(entry.detail, 300),
          evidence: Array.isArray(entry.evidence)
            ? entry.evidence.slice(0, 4).map((value) => text(value, 120)).filter(Boolean)
            : [],
          repo: text(entry.repo, 120) || null,
        }
      }).filter((item) => item.title)
    : []
  const gems = Array.isArray(raw.gems)
    ? raw.gems.slice(0, 3).map((item) => {
        const entry = item as Record<string, unknown>
        return {
          repo: text(entry.repo, 120),
          description: text(entry.description, 300),
          stars: Number(entry.stars) || 0,
          language: text(entry.language, 40) || null,
          reasons: Array.isArray(entry.reasons)
            ? entry.reasons.slice(0, 3).map((value) => text(value, 80)).filter(Boolean)
            : [],
          htmlUrl: text(entry.htmlUrl, 300),
        }
      }).filter((item) => item.repo)
    : []

  const token = await saveRadarSnapshot(getPool(), Number(currentUser.id), {
    login: currentUser.login,
    mode,
    persona,
    opportunities,
    gems,
  })
  redirect(`/radar/${token}`)
}
