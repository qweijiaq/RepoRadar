'use client'

import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'

export interface UiSelectOption {
  value: string
  label: string
  meta?: string
}

interface UiSelectProps {
  name?: string
  value: string
  onChange: (value: string) => void
  options: UiSelectOption[]
  placeholder?: string
  ariaLabel?: string
}

export function UiSelect({ name, value, onChange, options, placeholder = '请选择', ariaLabel }: UiSelectProps) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const selected = options.find((option) => option.value === value)

  useEffect(() => {
    if (!open) return
    const index = options.findIndex((option) => option.value === value)
    setActive(index >= 0 ? index : 0)
    // 只在打开时定位到当前值；依赖 options/value 会在父组件重渲染时打断键盘导航。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    const active = document.activeElement
    if (active instanceof HTMLElement && !rootRef.current?.contains(active)) active.blur()
    function handlePointer(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    function handleOther(event: Event) {
      if ((event as CustomEvent<string>).detail !== listId) setOpen(false)
    }
    document.addEventListener('mousedown', handlePointer)
    document.addEventListener('radar:dropdown-open', handleOther)
    document.dispatchEvent(new CustomEvent('radar:dropdown-open', { detail: listId }))
    return () => {
      document.removeEventListener('mousedown', handlePointer)
      document.removeEventListener('radar:dropdown-open', handleOther)
    }
  }, [open, listId])

  function choose(option: UiSelectOption) {
    onChange(option.value)
    setOpen(false)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Escape') {
      setOpen(false)
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!open) setOpen(true)
      setActive((index) => Math.min(options.length - 1, index + 1))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => Math.max(0, index - 1))
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (!open) {
        setOpen(true)
        return
      }
      const option = options[active]
      if (option) choose(option)
    }
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
  }

  return (
    <div className="ui-select" ref={rootRef} onBlur={handleBlur}>
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <button
        type="button"
        className="ui-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        onClick={(event) => {
          // Safari 点击按钮不会主动聚焦，显式聚焦避免焦点停留在上一个输入框
          event.currentTarget.focus()
          setOpen((current) => !current)
        }}
        onKeyDown={handleKeyDown}
      >
        <span className={selected ? 'ui-select-value' : 'ui-select-value placeholder'}>
          {selected?.label ?? placeholder}
        </span>
        <span className="ui-select-caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open ? (
        <div className="ui-select-panel" role="listbox" id={listId} aria-label={ariaLabel}>
          {options.map((option, index) => (
            <button
              type="button"
              role="option"
              aria-selected={option.value === value}
              key={option.value}
              className={index === active ? 'ui-select-option active' : 'ui-select-option'}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => {
                // 在输入框失焦前完成选择，避免 Safari 点击按钮不聚焦导致面板先关闭
                event.preventDefault()
                choose(option)
              }}
              onClick={() => choose(option)}
            >
              <span>{option.label}</span>
              {option.meta ? <span className="ui-select-meta">{option.meta}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
