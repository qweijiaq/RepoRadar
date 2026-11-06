'use client'

import { useEffect, useState } from 'react'
import type { NotificationCategory, NotificationPrefs } from '@repo-radar/core'
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
  { key: 'emailNotifications', label: '邮件通知', hint: '重要动态和任务失败发到通知邮箱' },
  { key: 'pushNotifications', label: '浏览器推送', hint: '需要先在下方授权此设备' },
  { key: 'weeklyDigest', label: '每周精选', hint: '每周一封个性化项目摘要' },
]

const CATEGORY_ITEMS: Array<{ key: NotificationCategory; label: string; hint: string }> = [
  { key: 'githubStar', label: 'Star', hint: '仓库新增 star' },
  { key: 'githubFork', label: 'Fork', hint: '仓库新增 fork' },
  { key: 'githubIssue', label: 'Issue', hint: '仓库新增 Issue' },
  { key: 'githubPull', label: 'PR', hint: '仓库新增 PR' },
  { key: 'githubRelease', label: 'Release 动态', hint: '维护中仓库发布新版本' },
  { key: 'release', label: '版本订阅', hint: 'release 订阅仓库发布新版本' },
  { key: 'ai', label: 'AI 工作', hint: '报告、方案、关注命中和任务结果' },
  { key: 'system', label: '系统', hint: '其他系统通知' },
]

const ALL_CATEGORIES = CATEGORY_ITEMS.map((item) => item.key)

function toggleCategory(
  list: NotificationCategory[],
  category: NotificationCategory,
  checked: boolean,
): NotificationCategory[] {
  if (checked) return list.includes(category) ? list : [...list, category]
  return list.filter((item) => item !== category)
}

export function NotificationPrefsForm({ initial }: { initial: NotificationPrefs }) {
  const [prefs, setPrefs] = useState(initial)
  const [emailKinds, setEmailKinds] = useState<NotificationCategory[]>(
    initial.emailKinds ?? ALL_CATEGORIES,
  )
  const [pushKinds, setPushKinds] = useState<NotificationCategory[]>(
    initial.pushKinds ?? ALL_CATEGORIES,
  )

  useEffect(() => {
    setPrefs(initial)
    setEmailKinds(initial.emailKinds ?? ALL_CATEGORIES)
    setPushKinds(initial.pushKinds ?? ALL_CATEGORIES)
  }, [initial])

  return (
    <form action={saveNotificationPrefsAction} className="notification-prefs-form">
      <input type="hidden" name="routingConfigured" value="1" />
      <p className="muted small">选择哪些 GitHub 动态进入收件箱。关闭后仍会记录事件，但不会产生通知。</p>
      <div className="notification-pref-grid">
        {ITEMS.map((item) => (
          <UiCheck
            key={item.key}
            name={item.key}
            checked={Boolean(prefs[item.key])}
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
            checked={Boolean(prefs[item.key])}
            onChange={(checked) => setPrefs((current) => ({ ...current, [item.key]: checked }))}
            label={item.label}
            hint={item.hint}
          />
        ))}
      </div>

      <div className="notification-matrix">
        <p className="muted small">
          邮件和推送可以分别选择类别；站内收件箱始终保留。总开关关闭时，对应渠道不会发送。
        </p>
        <div className="notification-matrix-head" aria-hidden="true">
          <span>类别</span>
          <span>邮件</span>
          <span>推送</span>
        </div>
        {CATEGORY_ITEMS.map((item) => (
          <div className="notification-matrix-row" key={item.key}>
            <span className="notification-matrix-label">
              {item.label}
              <small>{item.hint}</small>
            </span>
            <label className="notification-matrix-cell">
              <input
                type="checkbox"
                name="emailKinds"
                value={item.key}
                checked={emailKinds.includes(item.key)}
                onChange={(event) =>
                  setEmailKinds((current) => toggleCategory(current, item.key, event.target.checked))
                }
                disabled={!prefs.emailNotifications}
                aria-label={`${item.label} 邮件通知`}
              />
            </label>
            <label className="notification-matrix-cell">
              <input
                type="checkbox"
                name="pushKinds"
                value={item.key}
                checked={pushKinds.includes(item.key)}
                onChange={(event) =>
                  setPushKinds((current) => toggleCategory(current, item.key, event.target.checked))
                }
                disabled={!prefs.pushNotifications}
                aria-label={`${item.label} 浏览器推送`}
              />
            </label>
          </div>
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
