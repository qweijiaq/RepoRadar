'use client'

import { useState, type ReactNode } from 'react'

const SAFE_URL = /^(https?:\/\/|\/|#|mailto:)/i

const INLINE_PATTERN =
  /(`[^`\n]+`|\[[^\]]+\]\([^)\s]+\)|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_)/g

function inline(text: string, prefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let index = 0
  let key = 0
  INLINE_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = INLINE_PATTERN.exec(text))) {
    if (match.index > index) nodes.push(text.slice(index, match.index))
    const token = match[0]
    const nodeKey = `${prefix}-i${key++}`
    if (token.startsWith('`')) {
      nodes.push(
        <code className="md-inline-code" key={nodeKey}>
          {token.slice(1, -1)}
        </code>,
      )
    } else if (token.startsWith('[')) {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token)
      if (link && SAFE_URL.test(link[2] ?? '')) {
        nodes.push(
          <a key={nodeKey} href={link[2]} target="_blank" rel="noreferrer">
            {link[1]}
          </a>,
        )
      } else {
        nodes.push(link?.[1] ?? token)
      }
    } else if (token.startsWith('**') || token.startsWith('__')) {
      nodes.push(<strong key={nodeKey}>{inline(token.slice(2, -2), nodeKey)}</strong>)
    } else {
      nodes.push(<em key={nodeKey}>{inline(token.slice(1, -1), nodeKey)}</em>)
    }
    index = INLINE_PATTERN.lastIndex
  }
  if (index < text.length) nodes.push(text.slice(index))
  return nodes
}

function CodeBlock({ code, language }: { code: string; language: string | null }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="md-code-block">
      <div className="md-code-head">
        <span>{language ?? 'code'}</span>
        <button
          type="button"
          className="link-button"
          onClick={() => {
            void navigator.clipboard
              .writeText(code)
              .then(() => {
                setCopied(true)
                window.setTimeout(() => setCopied(false), 1400)
              })
              .catch(() => {})
          }}
        >
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  )
}

const BLOCK_START = /^(```|#{1,6}\s|>\s?|\s*[-*+]\s+|\s*\d+[.)]\s+)/

export function Markdown({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let index = 0
  let key = 0

  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (line.trim() === '') {
      index += 1
      continue
    }

    const fence = /^```([\w+-]*)\s*$/.exec(line)
    if (fence) {
      const language = fence[1] || null
      const code: string[] = []
      index += 1
      while (index < lines.length && !/^```/.test(lines[index] ?? '')) {
        code.push(lines[index] ?? '')
        index += 1
      }
      index += 1
      blocks.push(<CodeBlock key={`code-${key++}`} code={code.join('\n')} language={language} />)
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      const level = heading[1]?.length ?? 1
      const Tag = `h${Math.min(6, level)}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
      blocks.push(<Tag key={`h-${key++}`}>{inline(heading[2] ?? '', `h${key}`)}</Tag>)
      index += 1
      continue
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = []
      while (index < lines.length && /^>\s?/.test(lines[index] ?? '')) {
        quote.push((lines[index] ?? '').replace(/^>\s?/, ''))
        index += 1
      }
      blocks.push(
        <blockquote key={`q-${key++}`}>
          {inline(quote.join(' '), `q${key}`)}
        </blockquote>,
      )
      continue
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index] ?? '')) {
        items.push((lines[index] ?? '').replace(/^\s*[-*+]\s+/, ''))
        index += 1
      }
      blocks.push(
        <ul key={`ul-${key++}`}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{inline(item, `ul${key}-${itemIndex}`)}</li>
          ))}
        </ul>,
      )
      continue
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index] ?? '')) {
        items.push((lines[index] ?? '').replace(/^\s*\d+[.)]\s+/, ''))
        index += 1
      }
      blocks.push(
        <ol key={`ol-${key++}`}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{inline(item, `ol${key}-${itemIndex}`)}</li>
          ))}
        </ol>,
      )
      continue
    }

    const paragraph: string[] = []
    while (index < lines.length && (lines[index] ?? '').trim() !== '' && !BLOCK_START.test(lines[index] ?? '')) {
      paragraph.push(lines[index] ?? '')
      index += 1
    }
    blocks.push(
      <p key={`p-${key++}`}>
        {paragraph.flatMap((text, lineIndex) =>
          lineIndex === 0
            ? inline(text, `p${key}-${lineIndex}`)
            : [<br key={`br-${key}-${lineIndex}`} />, ...inline(text, `p${key}-${lineIndex}`)],
        )}
      </p>,
    )
  }

  return <div className="md-body">{blocks}</div>
}
