'use client'

import { useState } from 'react'
import { UiSelect } from '@/components/ui/Select'

const OPTIONS = [
  { value: 'topic', label: '主题' },
  { value: 'language', label: '语言' },
  { value: 'author', label: '作者' },
  { value: 'release', label: '仓库更新' },
]

export function SubscriptionKindSelect() {
  const [value, setValue] = useState('topic')
  return <UiSelect name="kind" value={value} onChange={setValue} options={OPTIONS} ariaLabel="订阅类型" />
}
