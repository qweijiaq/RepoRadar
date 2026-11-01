'use client'

import { useState } from 'react'

export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // 剪贴板不可用时忽略；用户仍可手动复制
    }
  }

  return (
    <button type="button" className="btn small" onClick={copy}>
      {copied ? '已复制' : '复制'}
    </button>
  )
}
