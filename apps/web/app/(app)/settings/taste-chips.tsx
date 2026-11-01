'use client'

import { useRef, useState } from 'react'
import { savePrefsAction } from '@/app/actions'

interface TasteChipsProps {
  topics: Array<[string, number]>
  languages: Array<[string, number]>
  initialExcludedTopics: string[]
  initialExcludedLanguages: string[]
}

export function TasteChips({
  topics,
  languages,
  initialExcludedTopics,
  initialExcludedLanguages,
}: TasteChipsProps) {
  const [excludedTopics, setExcludedTopics] = useState(initialExcludedTopics)
  const [excludedLanguages, setExcludedLanguages] = useState(initialExcludedLanguages)
  const formRef = useRef<HTMLFormElement>(null)

  function submitSoon() {
    window.setTimeout(() => formRef.current?.requestSubmit(), 0)
  }

  function toggleTopic(topic: string) {
    setExcludedTopics((current) => {
      const next = current.includes(topic) ? current.filter((item) => item !== topic) : [...current, topic]
      submitSoon()
      return next
    })
  }

  function toggleLanguage(language: string) {
    setExcludedLanguages((current) => {
      const next = current.includes(language) ? current.filter((item) => item !== language) : [...current, language]
      submitSoon()
      return next
    })
  }

  return (
    <form ref={formRef} action={savePrefsAction} className="taste-form">
      <input type="hidden" name="excludedTopics" value={excludedTopics.join(',')} />
      <input type="hidden" name="excludedLanguages" value={excludedLanguages.join(',')} />

      <p className="taste-label">主题</p>
      <div className="chips">
        {topics.map(([topic, weight]) => {
          const excluded = excludedTopics.includes(topic)
          return (
            <button
              key={topic}
              type="button"
              aria-pressed={excluded}
              className={excluded ? 'chip toggle excluded' : 'chip toggle'}
              title={excluded ? '点击恢复' : '点击排除'}
              onClick={() => toggleTopic(topic)}
            >
              {excluded ? '× ' : ''}
              {topic} · {Math.round(weight * 100)}%
            </button>
          )
        })}
      </div>

      {languages.length > 0 ? (
        <>
          <p className="taste-label">语言</p>
          <div className="chips">
            {languages.map(([language, weight]) => {
              const excluded = excludedLanguages.includes(language)
              return (
                <button
                  key={language}
                  type="button"
                  aria-pressed={excluded}
                  className={excluded ? 'chip toggle excluded' : 'chip toggle'}
                  title={excluded ? '点击恢复' : '点击排除'}
                  onClick={() => toggleLanguage(language)}
                >
                  {excluded ? '× ' : ''}
                  {language} · {Math.round(weight * 100)}%
                </button>
              )
            })}
          </div>
        </>
      ) : null}
    </form>
  )
}
