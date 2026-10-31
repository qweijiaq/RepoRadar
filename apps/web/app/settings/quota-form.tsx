'use client'

import { useState } from 'react'
import type { QuotaConfig, QuotaUsageSnapshot } from '@repo-radar/core'
import { UiCheck } from '@/components/ui/Check'
import { saveQuotaConfigAction } from '@/app/actions'

function usageLine(label: string, used: number, limit: number, unit = ''): string {
  return `${label}：${used}${unit}${limit > 0 ? ` / ${limit}${unit}` : '（不限）'}`
}

export function QuotaForm({ config, usage }: { config: QuotaConfig; usage: QuotaUsageSnapshot }) {
  const [aiEnabled, setAiEnabled] = useState(config.aiEnabled)

  return (
    <form action={saveQuotaConfigAction} className="webhook-form">
      <p className="muted small">
        0 表示不限制。限额按 UTC 自然日统计；已完成的模型调用才会计入 token 用量，因此并发请求可能轻微超出。
      </p>
      <UiCheck
        name="aiEnabled"
        checked={aiEnabled}
        onChange={setAiEnabled}
        label="启用 AI 功能"
        hint="关闭后所有 AI 任务和 Copilot 都会被拒绝，GitHub 动态同步不受影响"
      />

      <div className="quota-grid">
        <label className="field">
          <span>每用户每日 AI 调用次数</span>
          <input name="dailyAiCalls" type="number" min="0" defaultValue={config.dailyAiCalls} />
        </label>
        <label className="field">
          <span>每用户每日 AI tokens</span>
          <input name="dailyAiTokens" type="number" min="0" step="1000" defaultValue={config.dailyAiTokens} />
        </label>
        <label className="field">
          <span>全站每日 AI tokens</span>
          <input
            name="globalDailyTokens"
            type="number"
            min="0"
            step="100000"
            defaultValue={config.globalDailyTokens}
          />
        </label>
        <label className="field">
          <span>每用户每小时 AI 任务数</span>
          <input name="hourlyJobs" type="number" min="0" defaultValue={config.hourlyJobs} />
        </label>
        <label className="field">
          <span>每用户每日 AI 任务数</span>
          <input name="dailyJobs" type="number" min="0" defaultValue={config.dailyJobs} />
        </label>
        <label className="field">
          <span>每用户排队/运行中上限</span>
          <input name="maxQueuedJobs" type="number" min="0" defaultValue={config.maxQueuedJobs} />
        </label>
        <label className="field">
          <span>Copilot 每小时消息数</span>
          <input
            name="copilotMessagesPerHour"
            type="number"
            min="0"
            defaultValue={config.copilotMessagesPerHour}
          />
        </label>
        <label className="field">
          <span>每用户每日邮件/推送投递数</span>
          <input name="dailyDeliveries" type="number" min="0" defaultValue={config.dailyDeliveries} />
        </label>
      </div>

      <div className="quota-usage">
        <span>{usageLine('今日 AI 调用', usage.aiCalls, config.dailyAiCalls, ' 次')}</span>
        <span>{usageLine('今日 AI tokens', usage.aiTokens, config.dailyAiTokens)}</span>
        <span>{usageLine('全站今日 tokens', usage.globalTokens, config.globalDailyTokens)}</span>
        <span>{usageLine('今日任务', usage.jobsToday, config.dailyJobs, ' 个')}</span>
        <span>{usageLine('本小时任务', usage.jobsThisHour, config.hourlyJobs, ' 个')}</span>
        <span>{usageLine('当前排队/运行', usage.activeJobs, config.maxQueuedJobs, ' 个')}</span>
        <span>{usageLine('本小时 Copilot', usage.copilotThisHour, config.copilotMessagesPerHour, ' 条')}</span>
        <span>{usageLine('今日投递', usage.deliveriesToday, config.dailyDeliveries, ' 条')}</span>
      </div>

      <div className="webhook-form-actions">
        <button className="btn small" type="submit">
          保存限流配置
        </button>
      </div>
    </form>
  )
}
