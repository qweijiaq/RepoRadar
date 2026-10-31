'use client'

import { useState } from 'react'
import { saveGithubWebhookSecretAction } from '@/app/actions'

export function WebhookSecretForm({ hasExisting }: { hasExisting: boolean }) {
  const [secret, setSecret] = useState('')
  const [copied, setCopied] = useState(false)
  const [existingCopied, setExistingCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function copyExisting() {
    try {
      const response = await fetch('/api/settings/webhook-secret', { method: 'POST' })
      const data = (await response.json()) as { secret?: string; error?: string }
      if (!response.ok || !data.secret) throw new Error(data.error ?? '读取失败')
      await navigator.clipboard.writeText(data.secret)
      setExistingCopied(true)
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '复制失败')
    }
  }

  function generate() {
    const bytes = crypto.getRandomValues(new Uint8Array(24))
    const value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    setSecret(value)
    setError(null)
    navigator.clipboard?.writeText(value).then(
      () => setCopied(true),
      () => setCopied(false),
    )
  }

  return (
    <form
      action={saveGithubWebhookSecretAction}
      className="webhook-form"
      autoComplete="off"
      onSubmit={(event) => {
        if (!secret && !hasExisting) {
          event.preventDefault()
          setError('请先生成一个 Secret，或手动填写')
        }
      }}
    >
      <label className="field">
        <span>Webhook Secret</span>
        <input
          name="secret"
          type="text"
          value={secret}
          onChange={(event) => {
            setSecret(event.target.value)
            setCopied(false)
            setError(null)
          }}
          autoComplete="new-password"
          spellCheck={false}
          placeholder={hasExisting ? '已保存，留空保持不变' : '点「生成新的并复制」或手动填写'}
        />
      </label>
      <div className="webhook-form-actions">
        {hasExisting ? (
          <button type="button" className="btn quiet small" onClick={() => void copyExisting()}>
            {existingCopied ? '已复制' : '复制已保存的 Secret'}
          </button>
        ) : null}
        <button type="button" className="btn quiet small" onClick={generate}>
          生成新的并复制
        </button>
        <button className="btn small" type="submit">
          保存 Secret
        </button>
      </div>
      {hasExisting ? (
        <p className="muted small">生成新的 Secret 会替换旧值，已配置的 GitHub Webhook 需要同步更新。</p>
      ) : null}
      {copied ? <p className="muted small">已生成并复制，去 GitHub 的 Secret 输入框粘贴同一个值。</p> : null}
      {error ? <p className="job-error">{error}</p> : null}
    </form>
  )
}
