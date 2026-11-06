'use client'

import { useState } from 'react'
import { bulkCancelJobsAction, bulkRetryJobsAction } from './actions'

export function BulkJobActions() {
  const [pending, setPending] = useState<'cancel' | 'retry' | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function run(kind: 'cancel' | 'retry') {
    const ids = [...document.querySelectorAll<HTMLInputElement>('input[name="jobIds"]:checked')].map(
      (input) => input.value,
    )
    if (ids.length === 0) {
      setMessage('先勾选要操作的任务。')
      return
    }
    setMessage(null)
    setPending(kind)
    const formData = new FormData()
    for (const id of ids) formData.append('jobIds', id)
    try {
      if (kind === 'cancel') await bulkCancelJobsAction(formData)
      else await bulkRetryJobsAction(formData)
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="bulk-actions">
      <button
        type="button"
        className="btn quiet danger small"
        onClick={() => void run('cancel')}
        disabled={pending !== null}
      >
        {pending === 'cancel' ? '取消中…' : '批量取消'}
      </button>
      <button
        type="button"
        className="btn small"
        onClick={() => void run('retry')}
        disabled={pending !== null}
      >
        {pending === 'retry' ? '重试中…' : '批量重试'}
      </button>
      {message ? <span className="muted small">{message}</span> : null}
    </div>
  )
}
