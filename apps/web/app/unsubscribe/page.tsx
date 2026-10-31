import Link from 'next/link'
import { verifyUnsubscribeToken } from '@repo-radar/core'
import { unsubscribeAction } from './actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: '退订邮件 — RepoRadar' }

interface UnsubscribePageProps {
  searchParams: Promise<{ token?: string; status?: string }>
}

export default async function UnsubscribePage({ searchParams }: UnsubscribePageProps) {
  const params = await searchParams
  const token = params.token ?? ''
  const userId = token ? verifyUnsubscribeToken(token) : null

  return (
    <div className="page narrow">
      <p className="eyebrow">邮件偏好</p>
      <h1>退订每周精选</h1>
      {params.status === 'done' ? (
        <div className="notice success">
          已退订。你不会再收到每周精选和邮件通知；浏览器推送和站内收件箱不受影响，可以随时在设置页重新开启。
        </div>
      ) : params.status === 'invalid' || (token && !userId) ? (
        <div className="notice">退订链接无效或已过期，请到设置页修改通知偏好。</div>
      ) : userId ? (
        <section className="panel">
          <p className="muted">
            退订后不会再收到每周精选和邮件通知。站内收件箱和浏览器推送不受影响。也可以只关闭邮件、保留每周精选。
          </p>
          <form action={unsubscribeAction}>
            <input type="hidden" name="token" value={token} />
            <div className="form-actions">
              <button className="btn solid" type="submit">
                确认退订邮件
              </button>
              <Link className="btn quiet" href="/settings">
                改为只调整部分偏好
              </Link>
            </div>
          </form>
        </section>
      ) : (
        <div className="notice">
          请从邮件里的退订链接进入，或前往
          <Link href="/settings">设置页</Link>
          调整通知偏好。
        </div>
      )}
    </div>
  )
}
