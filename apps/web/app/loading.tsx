export default function Loading() {
  return (
    <div className="page narrow" aria-busy="true" aria-live="polite">
      <p className="eyebrow">加载中</p>
      <p className="muted">正在读取雷达数据…</p>
    </div>
  )
}
