'use client'

import type { RetentionConfig, RetentionLastRun } from '@repo-radar/core'
import { saveRetentionConfigAction } from '@/app/actions'

export function RetentionForm({ config, lastRun }: { config: RetentionConfig; lastRun: RetentionLastRun | null }) {
  return (
    <form action={saveRetentionConfigAction} className="webhook-form">
      <p className="muted small">
        按天清理过期的运行日志和通知；<code>0</code> 表示永久保留。清理每天最多运行一次，管理员也可以立即清理。
      </p>
      <div className="quota-grid">
        <label className="field">
          <span>已读通知保留天数</span>
          <input name="notificationsDays" type="number" min="0" defaultValue={config.notificationsDays} />
        </label>
        <label className="field">
          <span>已发送/失败投递保留天数</span>
          <input name="deliveryQueueDays" type="number" min="0" defaultValue={config.deliveryQueueDays} />
        </label>
        <label className="field">
          <span>已完成/失败任务保留天数</span>
          <input name="aiJobsDays" type="number" min="0" defaultValue={config.aiJobsDays} />
        </label>
        <label className="field">
          <span>GitHub 动态事件保留天数</span>
          <input name="activitySeenDays" type="number" min="0" defaultValue={config.activitySeenDays} />
        </label>
        <label className="field">
          <span>LLM 用量记录保留天数</span>
          <input name="llmUsageDays" type="number" min="0" defaultValue={config.llmUsageDays} />
        </label>
        <label className="field">
          <span>采集运行记录保留天数</span>
          <input name="ingestRunsDays" type="number" min="0" defaultValue={config.ingestRunsDays} />
        </label>
        <label className="field">
          <span>仓库验证记录保留天数</span>
          <input name="verificationsDays" type="number" min="0" defaultValue={config.verificationsDays} />
        </label>
        <label className="field">
          <span>Copilot 对话保留天数</span>
          <input name="copilotDays" type="number" min="0" defaultValue={config.copilotDays} />
        </label>
        <label className="field">
          <span>AI 生成内容保留天数</span>
          <input
            name="generatedContentDays"
            type="number"
            min="0"
            defaultValue={config.generatedContentDays}
          />
        </label>
      </div>
      <p className="muted small">
        最后一项会删除周报、接入建议、维护报告、选型对比、Issue 方案和补丁等历史版本，默认永久保留。设置为非零值前请确认。
      </p>
      <p className="muted small">
        最近一次清理：{lastRun ? `${new Date(lastRun.at).toLocaleString('zh-CN')}，共 ${lastRun.counts.total} 行` : '尚未运行'}
      </p>
      <div className="webhook-form-actions">
        <button className="btn small" type="submit">
          保存保留策略
        </button>
      </div>
    </form>
  )
}
