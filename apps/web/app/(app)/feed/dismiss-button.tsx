'use client'

import { useEffect, useId, useState, type ReactNode } from 'react'
import { createPortal, useFormStatus } from 'react-dom'
import { dismissFeedItemAction } from './actions'

const REASONS = [
  { value: 'too-broad', label: '太宽泛，不是我想找的' },
  { value: 'too-official', label: '又是官方/大厂项目' },
  { value: 'not-my-stack', label: '不是我的技术栈或方向' },
  { value: 'already-known', label: '我早就知道了' },
  { value: 'other', label: '其他原因' },
] as const

type FeedDismissReason = (typeof REASONS)[number]['value']

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus()
  return (
    <button className="btn danger small" type="submit" disabled={disabled || pending}>
      {pending ? '记录中…' : '确认不看'}
    </button>
  )
}

export function FeedDismissButton({
  itemKey,
  kind,
  returnTo,
  label = '不感兴趣',
  triggerClassName = 'btn quiet small',
}: {
  itemKey: string
  kind: string
  returnTo: string
  label?: ReactNode
  triggerClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [reason, setReason] = useState<FeedDismissReason | null>(null)
  const titleId = useId()

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  function show() {
    setReason(null)
    setOpen(true)
  }

  return (
    <>
      <button type="button" className={triggerClassName} onClick={show}>
        {label}
      </button>
      {mounted && open
        ? createPortal(
            <div
              className="ui-dialog-scrim"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) setOpen(false)
              }}
            >
              <div className="ui-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
                <h2 id={titleId}>为什么不想看？</h2>
                <p>告诉雷达原因，下次会按这个方向调整，而不只是隐藏这一条。</p>
                <form action={dismissFeedItemAction} className="dismiss-form">
                  <input type="hidden" name="itemKey" value={itemKey} />
                  <input type="hidden" name="kind" value={kind} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <input type="hidden" name="reason" value={reason ?? ''} />
                  <div className="dismiss-options">
                    {REASONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={reason === option.value ? 'dismiss-option active' : 'dismiss-option'}
                        onClick={() => setReason(option.value)}
                      >
                        <span className="dismiss-radio" aria-hidden="true">
                          {reason === option.value ? '●' : ''}
                        </span>
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <label className="field">
                    <span>补充说明（可选）</span>
                    <input name="note" maxLength={200} placeholder="例如：更想要 Python 的小工具" />
                  </label>
                  <div className="ui-dialog-actions">
                    <button type="button" className="btn quiet" onClick={() => setOpen(false)}>
                      取消
                    </button>
                    <SubmitButton disabled={!reason} />
                  </div>
                </form>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
