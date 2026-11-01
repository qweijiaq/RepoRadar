'use client'

import { useFormStatus } from 'react-dom'

export function GenerateDiscoverabilityButton() {
  const { pending } = useFormStatus()

  return (
    <button className="btn solid" type="submit" disabled={pending}>
      {pending ? '分析中…' : '分析可发现性'}
    </button>
  )
}
