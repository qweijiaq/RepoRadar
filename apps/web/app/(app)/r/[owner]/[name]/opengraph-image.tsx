import { ImageResponse } from 'next/og'

export const alt = 'RepoRadar 项目情报页'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

interface RepoImageProps {
  params: Promise<{ owner: string; name: string }>
}

export default async function RepoOpengraphImage({ params }: RepoImageProps) {
  const { owner, name } = await params
  const fullName = `${decodeURIComponent(owner)}/${decodeURIComponent(name)}`

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
            fontSize: fullName.length > 34 ? 60 : 78,
            fontWeight: 700,
            lineHeight: 1.15,
            wordBreak: 'break-all',
          }}
        >
          {fullName}
        </div>
        <div style={{ display: 'flex', fontSize: 30, color: '#9aa7bd' }}>
          Summary, score breakdown, similar projects and integration advice
        </div>
      </div>
    ),
    size,
  )
}
