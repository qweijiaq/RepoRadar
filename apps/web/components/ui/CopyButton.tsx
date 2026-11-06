'use client'

import { useState } from 'react'

export function CopyButton({
  value,
  label = '复制',
  copiedLabel = '已复制',
  className = 'btn small',
}: {
  value: string
  label?: string
  copiedLabel?: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // 剪贴板不可用时忽略；用户仍可手动选中复制
    }
  }

  return (
    <button type="button" className={className} onClick={copy}>
      {copied ? copiedLabel : label}
    </button>
  )
}
