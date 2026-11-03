'use client'

import { useRef, useState } from 'react'
import { toPng } from 'html-to-image'
import type { TrendingPost } from '@repo-radar/core'

interface TrendingPosterProps {
  post: TrendingPost
  text: string
}

export function TrendingPoster({ post, text }: TrendingPosterProps) {
  const posterRef = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function copyText(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
      setMessage('文字已复制，可以直接发小红书')
    } catch {
      setMessage('复制失败，请手动选择海报下方文字')
    }
  }

  async function exportImage(): Promise<void> {
    if (!posterRef.current) return
    setBusy(true)
    setMessage(null)
    try {
      const dataUrl = await toPng(posterRef.current, {
        pixelRatio: 2,
        backgroundColor: '#0b1020',
        cacheBust: true,
      })
      const link = document.createElement('a')
      link.download = `repo-radar-trending-${post.dateKey}.png`
      link.href = dataUrl
      link.click()
      setMessage('图片已导出（2x 分辨率）')
    } catch {
      setMessage('导出失败，请重试或截图保存')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="trending-share">
      <div className="feed-actions trending-actions">
        <button className="btn solid" type="button" onClick={copyText}>
          复制文字
        </button>
        <button className="btn" type="button" onClick={exportImage} disabled={busy}>
          {busy ? '导出中…' : '导出图片'}
        </button>
        {message ? <span className="muted small">{message}</span> : null}
      </div>

      <div className="trending-preview">
        <div className="trending-preview-scale">
          <div
            ref={posterRef}
            style={{
              width: 1080,
              minHeight: 1350,
              boxSizing: 'border-box',
              padding: '64px 64px 52px',
              background: 'linear-gradient(160deg, #0b1020 0%, #141a33 55%, #1b1030 100%)',
              color: '#f5f7ff',
              fontFamily:
                'system-ui, -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 26, letterSpacing: 4, color: '#9aa4ff', fontWeight: 700 }}>
                REPO RADAR
              </span>
              <span style={{ fontSize: 24, color: '#8b95b7' }}>{post.dateLabel} · 近 7 天</span>
            </div>

            <h1 style={{ fontSize: 58, lineHeight: 1.18, margin: '40px 0 18px', fontWeight: 800 }}>
              {post.copy.headline}
            </h1>
            <p style={{ fontSize: 26, lineHeight: 1.6, margin: 0, color: '#b8c0dd' }}>
              {post.copy.intro}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 18, marginTop: 36 }}>
              {post.items.map((item, index) => (
                <div
                  key={item.fullName}
                  style={{
                    display: 'flex',
                    gap: 20,
                    alignItems: 'flex-start',
                    padding: '18px 22px',
                    borderRadius: 18,
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.08)',
                  }}
                >
                  <span
                    style={{
                      width: 54,
                      fontSize: 32,
                      fontWeight: 800,
                      color: index < 3 ? '#ffd166' : '#7d87a8',
                      lineHeight: 1.2,
                    }}
                  >
                    {index + 1}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                      <span style={{ fontSize: 29, fontWeight: 700, wordBreak: 'break-all' }}>
                        {item.fullName}
                      </span>
                      <span style={{ fontSize: 27, fontWeight: 700, color: '#6ee7a8', whiteSpace: 'nowrap' }}>
                        +{item.gain.toLocaleString('en-US')} ★
                      </span>
                    </div>
                    <p style={{ fontSize: 23, lineHeight: 1.5, margin: '6px 0 0', color: '#a9b2d0' }}>
                      {post.copy.lines[item.fullName] ?? item.summary ?? ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {post.velocity.length > 0 ? (
              <div style={{ marginTop: 30 }}>
                <p style={{ fontSize: 24, fontWeight: 700, color: '#9aa4ff', margin: '0 0 10px' }}>
                  新库速度榜 · 建库以来日均 star
                </p>
                {post.velocity.map((item, index) => (
                  <div
                    key={item.fullName}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 16,
                      fontSize: 23,
                      padding: '6px 0',
                      borderBottom: '1px solid rgba(255,255,255,0.08)',
                    }}
                  >
                    <span style={{ color: '#c7cde4' }}>
                      {index + 1}. {item.fullName}
                    </span>
                    <span style={{ color: '#6ee7a8', whiteSpace: 'nowrap' }}>
                      {item.starsPerDay.toLocaleString('en-US')}/天
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            <div
              style={{
                marginTop: 'auto',
                paddingTop: 32,
                display: 'flex',
                justifyContent: 'space-between',
                gap: 20,
                fontSize: 22,
                color: '#7d87a8',
              }}
            >
              <span>{post.copy.hashtags.map((tag) => `#${tag}`).join(' ')}</span>
              <span>数据来自 RepoRadar</span>
            </div>
          </div>
        </div>
      </div>

      <pre className="trending-text">{text}</pre>
    </div>
  )
}
