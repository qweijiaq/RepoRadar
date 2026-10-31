'use client'

import { useFormStatus } from 'react-dom'

export function WatchSubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus()

  return (
    <button className="btn solid small" type="submit" disabled={pending}>
      {pending ? pendingLabel : label}
    </button>
  )
}
