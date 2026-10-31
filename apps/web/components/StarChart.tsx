import type { StarHistoryPoint } from '@repo-radar/core'

interface StarChartProps {
  points: StarHistoryPoint[]
  height?: number
}

export function StarChart({ points, height = 130 }: StarChartProps) {
  if (points.length === 0) {
    return <p className="muted small">还没有 star 快照。</p>
  }
  if (points.length === 1) {
    return (
      <p className="muted small">
        当前 {points[0]?.stars.toLocaleString('en-US')} stars，历史数据积累中（至少需要两天的快照）。
      </p>
    )
  }

  const width = 640
  const padding = 24
  const values = points.map((point) => point.stars)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const stepX = (width - padding * 2) / (points.length - 1)
  const coordinates = points.map(
    (point, index) =>
      [
        padding + index * stepX,
        height - padding - ((point.stars - min) / range) * (height - padding * 2),
      ] as const,
  )
  const path = coordinates.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const last = coordinates[coordinates.length - 1]

  return (
    <div className="star-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="star 历史走势">
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />
        {last ? <circle cx={last[0]} cy={last[1]} r="3.5" fill="var(--accent-2)" /> : null}
      </svg>
      <div className="star-chart-meta">
        <span>{points[0]?.date}</span>
        <span>峰值 {max.toLocaleString('en-US')}</span>
        <span>{points[points.length - 1]?.date}</span>
      </div>
    </div>
  )
}
