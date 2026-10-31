'use client'

import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'

export interface UiComboboxOption {
  value: string
  label?: string
}

interface UiComboboxProps {
  name: string
  value: string
  onChange: (value: string) => void
  options: UiComboboxOption[]
  placeholder?: string
  ariaLabel?: string
}

export function UiCombobox({ name, value, onChange, options, placeholder, ariaLabel }: UiComboboxProps) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [typing, setTyping] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  const query = typing ? value.trim().toLowerCase() : ''
  const filtered = (
    query
      ? options.filter(
          (option) =>
            option.value.toLowerCase().includes(query) || (option.label ?? '').toLowerCase().includes(query),
        )
      : options
  ).slice(0, 30)

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

  function choose(option: UiComboboxOption) {
    onChange(option.value)
    setOpen(false)
    setActive(-1)
    setTyping(false)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setOpen(false)
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!open) {
        setOpen(true)
        setTyping(false)
      }
      setActive((index) => Math.min(filtered.length - 1, index + 1))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => Math.max(0, index - 1))
      return
    }
    if (event.key === 'Enter' && open && active >= 0) {
      event.preventDefault()
      const option = filtered[active]
      if (option) choose(option)
    }
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
  }

  return (
    <div className="ui-combobox" ref={rootRef} onBlur={handleBlur}>
      <input
        className="ui-combobox-input"
        name={name}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        onChange={(event) => {
          onChange(event.target.value)
          setOpen(true)
          setActive(-1)
          setTyping(true)
        }}
        onClick={() => {
          setOpen(true)
          setTyping(false)
        }}
        onKeyDown={handleKeyDown}
      />

      {open && filtered.length > 0 ? (
        <div className="ui-combobox-panel" role="listbox" id={listId}>
          {filtered.map((option, index) => (
            <button
              type="button"
              role="option"
              aria-selected={option.value === value}
              key={option.value}
              className={index === active ? 'ui-combobox-option active' : 'ui-combobox-option'}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => {
                // 在输入框失焦前完成选择，避免 Safari 点击按钮不聚焦导致面板先关闭
                event.preventDefault()
                choose(option)
              }}
              onClick={() => choose(option)}
            >
              <span>{option.label ?? option.value}</span>
              {option.label && option.label !== option.value ? (
                <span className="ui-combobox-meta">{option.value}</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
