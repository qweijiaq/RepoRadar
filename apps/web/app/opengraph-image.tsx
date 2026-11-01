import { ImageResponse } from 'next/og'

export const alt = 'RepoRadar — 懂你口味的开源项目雷达'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OpengraphImage() {
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
          <div style={{ display: 'flex', fontSize: 30, letterSpacing: 8, color: '#6ea8fe' }}>
            REPORADAR
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ display: 'flex', fontSize: 74, fontWeight: 700, lineHeight: 1.1 }}>
            Find repos that fit your stack
          </div>
          <div style={{ display: 'flex', fontSize: 32, color: '#9aa7bd' }}>
            Personalized by your stars, projects and feedback
          </div>
        </div>
      </div>
    ),
    size,
  )
}
