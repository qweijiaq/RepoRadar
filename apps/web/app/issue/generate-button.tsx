'use client'

import { useFormStatus } from 'react-dom'

export function GenerateIssueButton({ hasDraft }: { hasDraft: boolean }) {
  const { pending } = useFormStatus()

  return (
    <button className="btn solid small" type="submit" disabled={pending}>
      {pending ? '生成中…' : hasDraft ? '重新生成' : '生成本期周报'}
    </button>
  )
}
