'use client'

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'

interface SearchResult {
  fullName: string
  url: string
  summary: string
  language: string | null
  stars: number
}

interface CommandItem {
  key: string
  label: string
  hint?: string
  href: string
}

const ACTIONS: CommandItem[] = [
  { key: 'feed', label: '雷达', hint: '今日推荐', href: '/feed' },
  { key: 'issue', label: '周报', hint: '生成或查看周报', href: '/issue' },
  { key: 'collections', label: '收藏集', hint: '你的收藏', href: '/collections' },
  { key: 'inbox', label: '收件箱', hint: '版本更新与动态', href: '/inbox' },
  { key: 'library', label: '建议库', hint: '历史推荐按库汇总', href: '/library' },
  { key: 'settings', label: '设置', hint: '模型与口味', href: '/settings' },
]

export function CommandPalette() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen((current) => !current)
      }
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setResults([])
    setActive(0)
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open) return
    const value = query.trim()
    if (!value) {
      setResults([])
      setLoading(false)
      return
    }

    const controller = new AbortController()
    setLoading(true)
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(value)}`, { signal: controller.signal })
        if (!response.ok) {
          setResults([])
          return
        }
        const data = (await response.json()) as { results?: SearchResult[] }
        setResults(data.results ?? [])
      } catch {
        // 请求被取消或失败时保留空结果
      } finally {
        setLoading(false)
      }
    }, 160)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [query, open])

  const actionItems = ACTIONS.filter((action) => {
    const value = query.trim().toLowerCase()
    return !value || action.label.includes(query.trim()) || action.key.includes(value)
  })
  const items: CommandItem[] = [
    ...actionItems,
    ...results.map((result) => ({
      key: result.fullName,
      label: result.fullName,
      hint: `${result.language ?? '未知语言'} · ★ ${result.stars.toLocaleString('en-US')}`,
      href: result.url,
    })),
  ]

  useEffect(() => setActive(0), [query, results.length])

  function go(item: CommandItem | undefined) {
    if (!item) return
    setOpen(false)
    router.push(item.href)
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => Math.min(items.length - 1, index + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => Math.max(0, index - 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      go(items[active])
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <>
      <button type="button" className="search-trigger" onClick={() => setOpen(true)}>
        搜索 <kbd>⌘K</kbd>
      </button>

      {mounted && open
        ? createPortal(
            <div
              className="command-scrim"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) setOpen(false)
              }}
            >
              <div className="command-panel" role="dialog" aria-modal="true" aria-label="搜索">
                <input
                  ref={inputRef}
                  className="command-input"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={onInputKeyDown}
                  placeholder="搜索仓库、页面…"
                  autoComplete="off"
                  spellCheck={false}
                />

                <div className="command-list" role="listbox">
                  {loading ? <p className="command-hint">搜索中…</p> : null}
                  {!loading && items.length === 0 ? <p className="command-hint">没有匹配结果</p> : null}
                  {items.map((item, index) => (
                    <button
                      key={`${item.key}-${index}`}
                      type="button"
                      role="option"
                      aria-selected={index === active}
                      className={index === active ? 'command-item active' : 'command-item'}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => go(item)}
                    >
                      <span>{item.label}</span>
                      {item.hint ? <span className="command-meta">{item.hint}</span> : null}
                    </button>
                  ))}
                </div>

                <p className="command-hint">↑↓ 选择 · ↵ 打开 · esc 关闭</p>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
