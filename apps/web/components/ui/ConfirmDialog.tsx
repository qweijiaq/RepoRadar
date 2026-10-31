'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface ConfirmDialogProps {
  action: (formData: FormData) => void | Promise<void>
  fields?: Record<string, string>
  triggerLabel: string
  triggerClassName?: string
  title: string
  description: string
  confirmLabel: string
}

export function ConfirmDialog({
  action,
  fields = {},
  triggerLabel,
  triggerClassName = 'btn quiet',
  title,
  description,
  confirmLabel,
}: ConfirmDialogProps) {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const submitRef = useRef<HTMLButtonElement>(null)
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

  function confirm() {
    setOpen(false)
    submitRef.current?.click()
  }

  return (
    <>
      <form action={action}>
        {Object.entries(fields).map(([key, value]) => (
          <input key={key} type="hidden" name={key} value={value} />
        ))}
        <button type="button" className={triggerClassName} onClick={() => setOpen(true)}>
          {triggerLabel}
        </button>
        <button ref={submitRef} type="submit" hidden />
      </form>

      {mounted && open
        ? createPortal(
            <div
              className="ui-dialog-scrim"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) setOpen(false)
              }}
            >
              <div className="ui-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
                <h2 id={titleId}>{title}</h2>
                <p>{description}</p>
                <div className="ui-dialog-actions">
                  <button type="button" className="btn quiet" onClick={() => setOpen(false)}>
                    取消
                  </button>
                  <button type="button" className="btn danger" onClick={confirm}>
                    {confirmLabel}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
