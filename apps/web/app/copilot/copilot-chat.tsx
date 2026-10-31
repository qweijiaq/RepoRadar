'use client'

import { useEffect, useRef, useState } from 'react'

export interface CopilotMessageView {
  id: string
  role: 'user' | 'assistant'
  content: string
  model: string | null
}

const SUGGESTIONS = [
  '这周先做什么？',
  '我的项目最该补什么？',
  '帮我从接入建议里挑一个',
  '我的方向是不是太散了？',
  '把维护周报变成三天计划',
]

export function CopilotChat({
  threadId,
  initialMessages,
}: {
  threadId: number
  initialMessages: CopilotMessageView[]
}) {
  const [messages, setMessages] = useState(initialMessages)
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, pending])

  async function send(text: string) {
    const message = text.trim()
    if (!message || pending) return
    setInput('')
    setError(null)
    setPending(true)
    setMessages((previous) => [
      ...previous,
      { id: `local-${Date.now()}`, role: 'user', content: message, model: null },
    ])

    try {
      const response = await fetch('/api/copilot', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message, threadId }),
      })
      const data = (await response.json()) as { content?: string; error?: string; model?: string }
      if (!response.ok || !data.content) {
        setError(data.error ?? '回答失败，请稍后再试')
        return
      }
      setMessages((previous) => [
        ...previous,
        {
          id: `local-${Date.now()}-a`,
          role: 'assistant',
          content: data.content!,
          model: data.model ?? null,
        },
      ])
    } catch {
      setError('网络错误，请检查服务后重试')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="copilot">
      <div className="copilot-thread">
        {messages.length === 0 ? (
          <div className="copilot-welcome">
            <p>我是你的项目搭档。</p>
            <p className="muted small">
              我读过你的维护项目、最新周报、接入建议和关注代理。可以直接问我现在最值得做什么。
            </p>
            <div className="copilot-suggestions">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  type="button"
                  className="mode-chip"
                  key={suggestion}
                  onClick={() => void send(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <div className={`copilot-message ${message.role}`} key={message.id}>
              <span className="copilot-role">{message.role === 'user' ? '你' : '雷达'}</span>
              <div className="copilot-bubble">
                {message.content}
                {message.role === 'assistant' && message.model ? (
                  <span className="copilot-model">{message.model}</span>
                ) : null}
              </div>
            </div>
          ))
        )}
        {pending ? (
          <div className="copilot-message assistant">
            <span className="copilot-role">雷达</span>
            <div className="copilot-bubble pending">正在看你的项目…</div>
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>

      {error ? <div className="notice">{error}</div> : null}

      <form
        className="copilot-form"
        onSubmit={(event) => {
          event.preventDefault()
          void send(input)
        }}
      >
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void send(input)
            }
          }}
          rows={2}
          maxLength={2000}
          placeholder="问它：这周先做什么？我该接入什么？我的项目有什么风险？"
        />
        <button className="btn solid" type="submit" disabled={pending || !input.trim()}>
          {pending ? '思考中…' : '发送'}
        </button>
      </form>
    </div>
  )
}
