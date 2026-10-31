'use client'

import { useFormStatus } from 'react-dom'

export function GenerateMaintainerButton() {
  const { pending } = useFormStatus()

  return (
    <button className="btn solid" type="submit" disabled={pending}>
      {pending ? '分析中…' : '生成维护周报'}
    </button>
  )
}
