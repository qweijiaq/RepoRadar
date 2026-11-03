'use client'

import { useRef, useState } from 'react'
import { toPng } from 'html-to-image'
import type { TrendingDetail, TrendingPost } from '@repo-radar/core'

interface TrendingPosterProps {
  post: TrendingPost
  text: string
  details: TrendingDetail[]
  /** 封面右上角的时间口径，例如「近 7 天」或「今日」 */
  periodLabel: string
}

const posterStyle: React.CSSProperties = {
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
}

const emerald = '#6ee7a8'
const muted = '#a9b2d0'
const faint = '#7d87a8'

function PosterHeader({ dateLabel, label }: { dateLabel: string; label: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: 26, letterSpacing: 4, color: '#9aa4ff', fontWeight: 700 }}>
        REPO RADAR
      </span>
      <span style={{ fontSize: 24, color: faint }}>
        {dateLabel} · {label}
      </span>
    </div>
  )
}

function PosterFooter({ hashtags }: { hashtags: string[] }) {
  return (
    <div
      style={{
        marginTop: 'auto',
        paddingTop: 32,
        display: 'flex',
        justifyContent: 'space-between',
        gap: 20,
        fontSize: 22,
        color: faint,
      }}
    >
      <span>{hashtags.map((tag) => `#${tag}`).join(' ')}</span>
      <span>数据来自 RepoRadar</span>
    </div>
  )
}

function DetailSlide({ detail, index, total }: { detail: TrendingDetail; index: number; total: number }) {
  return (
    <div style={posterStyle}>
      <PosterHeader dateLabel={`${index + 1} / ${total}`} label="仓库详情" />
      <h1 style={{ fontSize: 54, lineHeight: 1.2, margin: '34px 0 16px', wordBreak: 'break-all' }}>
        {detail.fullName}
      </h1>

      <div style={{ display: 'flex', gap: 18, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 34, fontWeight: 800, color: emerald }}>
          +{detail.gain.toLocaleString('en-US')} ★
        </span>
        <span style={{ fontSize: 24, color: muted }}>
          共 {detail.stars.toLocaleString('en-US')} stars · +{(detail.growth * 100).toFixed(1)}%
        </span>
        {detail.language ? <span style={{ fontSize: 24, color: muted }}>{detail.language}</span> : null}
      </div>

      <p style={{ fontSize: 27, lineHeight: 1.6, color: '#c7cde4', margin: '26px 0 0' }}>
        {detail.positioning}
      </p>

      {detail.topics.length === 0 ? (
        <p style={{ fontSize: 21, color: faint, marginTop: 14 }}>
          GitHub 上没有设置 topic，所以这里没有主题标签。
        </p>
      ) : detail.topicsSource === 'ai' ? (
        <p style={{ fontSize: 20, color: faint, marginTop: 10 }}>主题由 AI 从 README 推断。</p>
      ) : null}
      {detail.topics.length > 0 ? (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 16 }}>
          {detail.topics.map((topic) => (
            <span
              key={topic}
              style={{
                fontSize: 21,
                color: '#9aa4ff',
                border: '1px solid rgba(154,164,255,0.35)',
                borderRadius: 999,
                padding: '4px 14px',
              }}
            >
              #{topic}
            </span>
          ))}
        </div>
      ) : null}

      <h2 style={{ fontSize: 28, color: '#9aa4ff', margin: '34px 0 14px' }}>它能做什么</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {detail.features.map((feature) => (
          <div
            key={feature.name}
            style={{
              padding: '14px 18px',
              borderRadius: 14,
              background: 'rgba(255,255,255,0.055)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <div style={{ fontSize: 25, fontWeight: 700 }}>{feature.name}</div>
            <div style={{ fontSize: 22, color: muted, marginTop: 4, lineHeight: 1.5 }}>
              {feature.detail}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 30, marginTop: 30 }}>
        {detail.useCases.length > 0 ? (
          <div style={{ flex: 1 }}>
            <h3 style={{ fontSize: 24, color: '#9aa4ff', margin: '0 0 8px' }}>适合</h3>
            {detail.useCases.map((item) => (
              <p key={item} style={{ fontSize: 22, lineHeight: 1.5, color: muted, margin: '0 0 6px' }}>
                · {item}
              </p>
            ))}
          </div>
        ) : null}
        {detail.quickstart.length > 0 ? (
          <div style={{ flex: 1 }}>
            <h3 style={{ fontSize: 24, color: '#9aa4ff', margin: '0 0 8px' }}>快速上手</h3>
            {detail.quickstart.map((item, step) => (
              <p key={item} style={{ fontSize: 22, lineHeight: 1.5, color: muted, margin: '0 0 6px' }}>
                {step + 1}. {item}
              </p>
            ))}
          </div>
        ) : null}
      </div>

      {!detail.hasProfile ? (
        <p style={{ fontSize: 20, color: faint, marginTop: 22 }}>
          这个仓库还没有 AI 功能画像；在仓库页生成后，这里会显示更完整的能力说明。
        </p>
      ) : null}

      <PosterFooter hashtags={['GitHub', '开源', 'AI']} />
    </div>
  )
}

export function TrendingPoster({ post, text, details, periodLabel }: TrendingPosterProps) {
  const coverRef = useRef<HTMLDivElement>(null)
  const detailRefs = useRef<Array<HTMLDivElement | null>>([])
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

  async function download(node: HTMLDivElement | null, suffix: string): Promise<void> {
    if (!node) return
    const dataUrl = await toPng(node, {
      pixelRatio: 2,
      backgroundColor: '#0b1020',
      cacheBust: true,
    })
    const link = document.createElement('a')
    link.download = `repo-radar-trending-${post.dateKey}-${suffix}.png`
    link.href = dataUrl
    link.click()
  }

  async function exportAll(): Promise<void> {
    setBusy(true)
    setMessage(null)
    try {
      const nodes = [coverRef.current, ...detailRefs.current].filter(
        (node): node is HTMLDivElement => Boolean(node),
      )
      for (const [index, node] of nodes.entries()) {
        await download(node, String(index + 1))
        await new Promise((resolve) => setTimeout(resolve, 400))
      }
      setMessage(`已导出 ${nodes.length} 张；如果浏览器拦截多文件下载，请用每张下方的按钮逐张导出`)
    } catch {
      setMessage('导出失败，请重试或截图保存')
    } finally {
      setBusy(false)
    }
  }

  async function exportOne(node: HTMLDivElement | null, suffix: string): Promise<void> {
    setBusy(true)
    setMessage(null)
    try {
      await download(node, suffix)
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
        <button className="btn" type="button" onClick={exportAll} disabled={busy}>
          {busy ? '导出中…' : `导出全部图片（${1 + details.length} 张）`}
        </button>
        {message ? <span className="muted small">{message}</span> : null}
      </div>

      <nav className="trending-index" aria-label="分享卡目录">
        <a href="#slide-cover">封面</a>
        {details.map((detail, index) => (
          <a key={detail.fullName} href={`#slide-${index + 1}`}>
            {index + 1}. {detail.fullName.split('/')[1] ?? detail.fullName}
          </a>
        ))}
      </nav>

      <div className="trending-slide" id="slide-cover">
        <div className="trending-preview">
          <div className="trending-preview-scale">
            <div ref={coverRef} style={posterStyle}>
              <PosterHeader dateLabel={post.dateLabel} label={periodLabel} />
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
                        color: index < 3 ? '#ffd166' : faint,
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
                        <span style={{ fontSize: 27, fontWeight: 700, color: emerald, whiteSpace: 'nowrap' }}>
                          +{item.gain.toLocaleString('en-US')} ★
                        </span>
                      </div>
                      <p style={{ fontSize: 23, lineHeight: 1.5, margin: '6px 0 0', color: muted }}>
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
                      <span style={{ color: emerald, whiteSpace: 'nowrap' }}>
                        {item.starsPerDay.toLocaleString('en-US')}/天
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}

              <PosterFooter hashtags={post.copy.hashtags} />
            </div>
          </div>
        </div>
        <div className="feed-actions">
          <button className="btn quiet small" type="button" onClick={() => exportOne(coverRef.current, '1')}>
            导出图片
          </button>
        </div>
      </div>

      {details.map((detail, index) => (
        <div className="trending-slide" id={`slide-${index + 1}`} key={detail.fullName}>
          <div className="trending-preview">
            <div className="trending-preview-scale">
              <div
                ref={(node) => {
                  detailRefs.current[index] = node
                }}
              >
                <DetailSlide detail={detail} index={index + 1} total={details.length} />
              </div>
            </div>
          </div>
          <div className="feed-actions">
            <button
              className="btn quiet small"
              type="button"
              onClick={() => exportOne(detailRefs.current[index] ?? null, String(index + 2))}
            >
              导出这张
            </button>
          </div>
        </div>
      ))}

      <pre className="trending-text">{text}</pre>
    </div>
  )
}
