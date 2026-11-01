'use client'

import { useState } from 'react'
import type { OpsConfig } from '@repo-radar/core'
import { UiCheck } from '@/components/ui/Check'
import { saveOpsConfigAction } from '@/app/actions'

export function OpsConfigForm({ config }: { config: OpsConfig }) {
  const [enabled, setEnabled] = useState(config.alertsEnabled)

  return (
    <form action={saveOpsConfigAction} className="webhook-form">
      <UiCheck
        name="alertsEnabled"
        checked={enabled}
        onChange={setEnabled}
        label="启用邮件告警"
        hint="任务失败、投递失败、队列积压和 worker 心跳异常时通知管理员"
      />
      <label className="field">
        <span>告警收件邮箱（可选，逗号分隔）</span>
        <input
          name="alertEmails"
          defaultValue={config.alertEmails}
          placeholder="留空则发给管理员的通知邮箱"
          spellCheck={false}
        />
      </label>
      <div className="quota-grid">
        <label className="field">
          <span>15 分钟内失败任务阈值</span>
          <input name="failedJobsThreshold" type="number" min="0" defaultValue={config.failedJobsThreshold} />
        </label>
        <label className="field">
          <span>15 分钟内失败投递阈值</span>
          <input
            name="failedDeliveriesThreshold"
            type="number"
            min="0"
            defaultValue={config.failedDeliveriesThreshold}
          />
        </label>
        <label className="field">
          <span>队列积压告警（分钟）</span>
          <input name="queueAgeMinutes" type="number" min="0" defaultValue={config.queueAgeMinutes} />
        </label>
        <label className="field">
          <span>同类告警冷却（分钟）</span>
          <input name="cooldownMinutes" type="number" min="1" defaultValue={config.cooldownMinutes} />
        </label>
      </div>
      <p className="muted small">
        `0` 表示关闭对应的阈值告警。告警邮件由 worker 直接发送，不进入普通通知队列。
      </p>
      <div className="webhook-form-actions">
        <button className="btn small" type="submit">
          保存告警配置
        </button>
      </div>
    </form>
  )
}
