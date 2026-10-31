'use client'

import { useEffect, useRef, useState } from 'react'

type CopyState = 'idle' | 'copied' | 'failed'

function fallbackCopy(text: string): void {
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.top = '0'
  area.style.left = '0'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  const ok = document.execCommand('copy')
  area.remove()
  if (!ok) throw new Error('copy failed')
}

export function CopyIntegrationButton({
  text,
  label,
  className = 'btn quiet small',
}: {
  text: string
  label: string
  className?: string
}) {
  const [state, setState] = useState<CopyState>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  async function copy() {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text)
      else fallbackCopy(text)
      setState('copied')
    } catch {
      try {
        fallbackCopy(text)
        setState('copied')
      } catch {
        setState('failed')
      }
    }

    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), 1800)
  }

  return (
    <button
      type="button"
      className={className}
      onClick={copy}
      title="复制为可交给代码 AI 的接入任务书"
    >
      {state === 'copied' ? '已复制' : state === 'failed' ? '复制失败' : label}
      <span className="sr-only" role="status">
        {state === 'copied' ? '接入任务书已复制到剪贴板' : ''}
      </span>
    </button>
  )
}
