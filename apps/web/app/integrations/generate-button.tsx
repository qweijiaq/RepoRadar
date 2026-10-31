'use client'

import { useFormStatus } from 'react-dom'

export function GenerateIntegrationButton() {
  const { pending } = useFormStatus()

  return (
    <button className="btn solid" type="submit" disabled={pending}>
      {pending ? '分析中…' : '生成接入建议'}
    </button>
  )
}
