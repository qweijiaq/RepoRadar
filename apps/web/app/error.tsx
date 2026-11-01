'use client'

import Link from 'next/link'
import { useEffect } from 'react'

function errorDigest(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('digest' in error)) return null
  const digest = (error as { digest?: unknown }).digest
  return typeof digest === 'string' && digest.length > 0 ? digest : null
}

export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    // 暂时只打到浏览器控制台；接入错误上报后改成上报。
    console.error('[app] 页面渲染失败', error)
  }, [error])

  const digest = errorDigest(error)

  return (
    <div className="page narrow">
      <p className="eyebrow">出错了</p>
      <h1>这个页面没能加载出来</h1>
      <p className="muted">
        可能是数据库或外部服务暂时不可用。可以先重试一次；如果一直失败，把下面的错误编号发给管理员。
      </p>
      {digest ? <p className="muted small">错误编号：{digest}</p> : null}
      <p>
        <button className="btn solid" type="button" onClick={() => retry()}>
          重新加载
        </button>{' '}
        <Link className="btn quiet" href="/feed">
          回到雷达
        </Link>
      </p>
    </div>
  )
}
