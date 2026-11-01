'use client'

import { useEffect, useState } from 'react'
import type { NotificationPrefs } from '@repo-radar/core'
import { UiCheck } from '@/components/ui/Check'
import { saveNotificationPrefsAction } from '@/app/actions'

const ITEMS: Array<{ key: keyof NotificationPrefs; label: string; hint: string }> = [
  { key: 'githubStar', label: 'Star', hint: '别人 star 你的仓库' },
  { key: 'githubFork', label: 'Fork', hint: '别人 fork 你的仓库' },
  { key: 'githubIssue', label: 'Issue', hint: '别人打开 Issue' },
  { key: 'githubPull', label: 'PR', hint: '别人打开 PR' },
  { key: 'githubRelease', label: 'Release', hint: '仓库发布新版本' },
]

const DELIVERY_ITEMS: Array<{ key: keyof NotificationPrefs; label: string; hint: string }> = [
  { key: 'emailNotifications', label: '邮件通知', hint: '重要动态和任务失败发到 GitHub 邮箱' },
  { key: 'pushNotifications', label: '浏览器推送', hint: '需要先在下方授权此设备' },
  { key: 'weeklyDigest', label: '每周精选', hint: '每周一封个性化项目摘要' },
]

export function NotificationPrefsForm({ initial }: { initial: NotificationPrefs }) {
  const [prefs, setPrefs] = useState(initial)
  useEffect(() => {
    setPrefs(initial)
  }, [initial])

  return (
    <form action={saveNotificationPrefsAction} className="notification-prefs-form">
      <p className="muted small">选择哪些 GitHub 动态进入收件箱。关闭后仍会记录事件，但不会产生通知。</p>
      <div className="notification-pref-grid">
        {ITEMS.map((item) => (
          <UiCheck
            key={item.key}
            name={item.key}
            checked={prefs[item.key]}
            onChange={(checked) => setPrefs((current) => ({ ...current, [item.key]: checked }))}
            label={item.label}
            hint={item.hint}
          />
        ))}
      </div>
      <h3 className="maintain-subhead">送达方式</h3>
      <div className="notification-pref-grid">
        {DELIVERY_ITEMS.map((item) => (
          <UiCheck
            key={item.key}
            name={item.key}
            checked={prefs[item.key]}
            onChange={(checked) => setPrefs((current) => ({ ...current, [item.key]: checked }))}
            label={item.label}
            hint={item.hint}
          />
        ))}
      </div>
      <div className="form-actions">
        <button className="btn solid small" type="submit">
          保存通知偏好
        </button>
      </div>
    </form>
  )
}
