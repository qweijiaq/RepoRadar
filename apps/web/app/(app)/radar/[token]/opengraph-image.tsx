import { ImageResponse } from 'next/og'
import { findRadarSnapshot } from '@repo-radar/core'
import { getPool } from '@repo-radar/core'

export const alt = 'RepoRadar 共享雷达'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

interface RadarImageProps {
  params: Promise<{ token: string }>
}

const MODE_LABEL: Record<string, string> = {
  balanced: 'BALANCED',
  focus: 'SHIP PROJECTS',
  swap: 'SWAP TOOLS',
  explore: 'EXPLORE',
  new: 'NEW & RISING',
}

export default async function SharedRadarOpengraphImage({ params }: RadarImageProps) {
  const { token } = await params
  let login: string | null = null
  let mode = 'balanced'
  let repos: string[] = []

  try {
    const snapshot = await findRadarSnapshot(getPool(), token)
    if (snapshot) {
      login = snapshot.login
      mode = snapshot.mode
      repos = snapshot.gems.slice(0, 3).map((gem) => gem.repo)
    }
  } catch {
    // 数据库不可用时退回通用卡片，不要让分享图 500。
  }

  const headline = login ? `${login}'s radar` : 'Shared radar'
  const modeLabel = MODE_LABEL[mode] ?? mode.toUpperCase()

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '72px',
          background: 'linear-gradient(135deg, #0a0c11 0%, #121a2b 60%, #0d1524 100%)',
          color: '#e7ecf6',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <div
              style={{
                width: 18,
                height: 18,
                borderRadius: 999,
                border: '3px solid #6ea8fe',
                display: 'flex',
              }}
            />
            <div style={{ display: 'flex', fontSize: 28, letterSpacing: 8, color: '#6ea8fe' }}>
              REPORADAR
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: 24,
              letterSpacing: 3,
              color: '#9aa7bd',
              border: '2px solid #2a3550',
              borderRadius: 999,
              padding: '10px 22px',
            }}
          >
            {modeLabel}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
          <div style={{ display: 'flex', fontSize: 76, fontWeight: 700, lineHeight: 1.1 }}>
            {headline}
          </div>
          {repos.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {repos.map((repo) => (
                <div key={repo} style={{ display: 'flex', fontSize: 30, color: '#c7d2e5' }}>
                  {repo}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', fontSize: 30, color: '#9aa7bd' }}>
              A read-only snapshot of someone&apos;s open source radar
            </div>
          )}
        </div>
      </div>
    ),
    size,
  )
}
