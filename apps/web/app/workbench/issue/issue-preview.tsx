'use client'

import { useEffect, useRef, useState } from 'react'

interface Heading {
  id: string
  text: string
}

export function IssuePreview({ html, title }: { html: string; title: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [headings, setHeadings] = useState<Heading[]>([])

  function prepareToc() {
    const doc = frameRef.current?.contentDocument
    if (!doc) return
    const found = Array.from(doc.querySelectorAll('h1, h2, h3'))
    setHeadings(
      found.map((heading, index) => {
        const id = heading.id || `issue-section-${index}`
        heading.id = id
        return { id, text: heading.textContent?.trim() || `第 ${index + 1} 节` }
      }),
    )
  }

  function jump(id: string) {
    const target = frameRef.current?.contentDocument?.getElementById(id)
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    if (frame.contentDocument?.readyState === 'complete') {
      prepareToc()
      return
    }
    const onLoad = () => prepareToc()
    frame.addEventListener('load', onLoad)
    return () => frame.removeEventListener('load', onLoad)
    // prepareToc reads the iframe document after hydration; html changes should rebuild the list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html])

  return (
    <>
      {headings.length > 1 ? (
        <nav className="issue-toc" aria-label="周报目录">
          {headings.map((heading) => (
            <button type="button" key={heading.id} onClick={() => jump(heading.id)}>
              {heading.text}
            </button>
          ))}
        </nav>
      ) : null}
      <iframe
        ref={frameRef}
        className="issue-preview"
        title={title}
        srcDoc={html}
        sandbox="allow-same-origin"
        onLoad={prepareToc}
      />
    </>
  )
}
