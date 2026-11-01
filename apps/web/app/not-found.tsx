import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="page narrow">
      <p className="eyebrow">404</p>
      <h1>没有找到这个页面</h1>
      <p className="muted">链接可能已经过期，或者这个仓库还没有进入雷达。</p>
      <p>
        <Link className="btn solid" href="/feed">
          回到雷达
        </Link>{' '}
        <Link className="btn quiet" href="/">
          返回首页
        </Link>
      </p>
    </div>
  )
}
