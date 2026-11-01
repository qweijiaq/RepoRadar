'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const output = new Uint8Array(raw.length)
  for (let index = 0; index < raw.length; index += 1) output[index] = raw.charCodeAt(index)
  return output
}

type Status = 'checking' | 'unsupported' | 'off' | 'on' | 'denied'

export function PushSubscribe() {
  const router = useRouter()
  const [status, setStatus] = useState<Status>('checking')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function check() {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        if (!cancelled) setStatus('unsupported')
        return
      }
      if (Notification.permission === 'denied') {
        if (!cancelled) setStatus('denied')
        return
      }
      try {
        const registration = await navigator.serviceWorker.register('/sw.js')
        const subscription = await registration.pushManager.getSubscription()
        if (!cancelled) setStatus(subscription ? 'on' : 'off')
      } catch {
        if (!cancelled) setStatus('off')
      }
    }
    void check()
    return () => {
      cancelled = true
    }
  }, [])

  async function subscribe() {
    setBusy(true)
    setMessage(null)
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setStatus(permission === 'denied' ? 'denied' : 'off')
        setMessage('浏览器没有授予通知权限。')
        return
      }
      const response = await fetch('/api/push/public-key')
      const data = (await response.json()) as { publicKey?: string; error?: string }
      if (!response.ok || !data.publicKey) throw new Error(data.error ?? '读取推送公钥失败')
      const registration = await navigator.serviceWorker.register('/sw.js')
      const existing = await registration.pushManager.getSubscription()
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(data.publicKey),
        }))
      const saved = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(subscription.toJSON()),
      })
      if (!saved.ok) {
        const error = (await saved.json().catch(() => ({}))) as { error?: string }
        throw new Error(error.error ?? '保存订阅失败')
      }
      setStatus('on')
      setMessage('此设备已开启浏览器推送。')
      router.refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '开启推送失败')
    } finally {
      setBusy(false)
    }
  }

  async function unsubscribe() {
    setBusy(true)
    setMessage(null)
    try {
      const registration = await navigator.serviceWorker.getRegistration('/')
      const subscription = await registration?.pushManager.getSubscription()
      if (subscription) {
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        })
        await subscription.unsubscribe()
      }
      setStatus('off')
      setMessage('此设备已关闭浏览器推送。')
      router.refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '关闭推送失败')
    } finally {
      setBusy(false)
    }
  }

  async function sendTest() {
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch('/api/push/test', { method: 'POST' })
      const data = (await response.json()) as { sent?: number; removed?: number; error?: string }
      if (!response.ok) throw new Error(data.error ?? '测试推送失败')
      setMessage(
        data.sent
          ? `已发送 ${data.sent} 条测试推送${data.removed ? `，清理 ${data.removed} 个失效订阅` : ''}。`
          : '没有可用的推送订阅，请先开启此设备。',
      )
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '测试推送失败')
    } finally {
      setBusy(false)
    }
  }

  const hint = '推送由后台 worker 投递，关闭页面后也能收到；VAPID 密钥会自动生成并保存在数据库。'

  return (
    <div className="webhook-box">
      <h3 className="maintain-subhead">浏览器推送</h3>
      <p className="muted small">{hint}</p>
      {status === 'unsupported' ? (
        <p className="muted small">当前浏览器不支持 Web Push，请使用 Chrome / Edge / Safari 16+。</p>
      ) : status === 'denied' ? (
        <p className="job-error">通知权限已被浏览器拒绝，请在地址栏的站点设置中重新允许。</p>
      ) : (
        <div className="webhook-form-actions">
          {status === 'on' ? (
            <>
              <button type="button" className="btn quiet small" onClick={() => void unsubscribe()} disabled={busy}>
                关闭此设备的推送
              </button>
              <button type="button" className="btn small" onClick={() => void sendTest()} disabled={busy}>
                发送测试推送
              </button>
            </>
          ) : (
            <button type="button" className="btn small" onClick={() => void subscribe()} disabled={busy || status === 'checking'}>
              {busy ? '处理中…' : '允许此设备接收推送'}
            </button>
          )}
        </div>
      )}
      {message ? <p className="muted small">{message}</p> : null}
    </div>
  )
}
