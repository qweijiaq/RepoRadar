import Link from 'next/link'
import {
  loadAlertLog,
  loadOpsConfig,
  loadOpsMetrics,
  loadRecentFailures,
  renderPrometheus,
} from '@repo-radar/core'
import { resetOpsConfigAction } from '@/app/actions'
import { requireAdmin } from '@/lib/admin'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { getPool } from '@/lib/db'
import { OpsConfigForm } from './ops-config-form'

export const dynamic = 'force-dynamic'
export const metadata = { title: '运维面板 — RepoRadar' }

function bytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`
}

interface OpsPageProps {
  searchParams: Promise<{ saved?: string; reset?: string }>
}

export default async function OpsPage({ searchParams }: OpsPageProps) {
  await requireAdmin()
  const params = await searchParams
  const pool = getPool()
  const [metrics, failures, config, alertLog] = await Promise.all([
    loadOpsMetrics(pool),
    loadRecentFailures(pool),
    loadOpsConfig(pool),
    loadAlertLog(pool),
  ])

  return (
    <div className="page narrow">
      <p className="muted small">
        <Link href="/settings">← 返回设置</Link>
      </p>
      <section className="feed-head">
        <div>
          <p className="eyebrow">运维</p>
          <h1>运行状态与告警</h1>
          <p className="feed-meta">任务、投递、token 用量和最近失败记录。仅管理员可见。</p>
        </div>
        <div className="feed-actions">
          <a className="btn small" href="/api/metrics">
            Prometheus 指标
          </a>
          <Link className="btn quiet small" href="/settings">
            设置
          </Link>
        </div>
      </section>

      {params.saved ? <div className="notice success">告警配置已保存。</div> : null}
      {params.reset ? <div className="notice success">告警配置已恢复默认。</div> : null}

      <div className="quota-usage">
        <span>用户 {metrics.users}</span>
        <span>排队任务 {metrics.jobsQueued}</span>
        <span>运行任务 {metrics.jobsRunning}</span>
        <span>24h 失败任务 {metrics.jobsFailed24h}</span>
        <span>待投递 {metrics.deliveriesPending}</span>
        <span>24h 失败投递 {metrics.deliveriesFailed24h}</span>
        <span>最老待投递 {Math.round(metrics.oldestPendingSeconds / 60)} 分钟</span>
        <span>今日 tokens {metrics.llmTokensToday}</span>
        <span>数据库 {bytes(metrics.dbSizeBytes)}</span>
        <span>心跳超时任务 {metrics.staleRunningJobs}</span>
      </div>

      <section className="panel">
        <h2>Prometheus</h2>
        <p className="muted small">
          {process.env.METRICS_TOKEN
            ? 'METRICS_TOKEN 已配置。抓取时需要 Authorization: Bearer <token>。'
            : '尚未配置 METRICS_TOKEN，/api/metrics 会返回 404。请在环境变量中设置后重启 Web。'}
        </p>
        <pre className="log-block">{renderPrometheus(metrics)}</pre>
      </section>

      <div className="maintain-columns">
        <section className="panel">
          <h2>最近失败任务</h2>
          {failures.jobs.length === 0 ? (
            <p className="muted small">最近没有失败任务。</p>
          ) : (
            <ul className="maintain-list">
              {failures.jobs.map((job) => (
                <li key={job.id}>
                  {new Date(job.finishedAt ?? Date.now()).toLocaleString('zh-CN')} · {job.kind} · {job.title}
                  {job.error ? <span className="muted small"> — {job.error.slice(0, 160)}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="panel">
          <h2>最近失败投递</h2>
          {failures.deliveries.length === 0 ? (
            <p className="muted small">最近没有失败投递。</p>
          ) : (
            <ul className="maintain-list">
              {failures.deliveries.map((delivery) => (
                <li key={delivery.id}>
                  {new Date(delivery.createdAt).toLocaleString('zh-CN')} · {delivery.channel} · {delivery.subject}
                  {delivery.lastError ? <span className="muted small"> — {delivery.lastError.slice(0, 160)}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="panel">
        <h2>告警配置</h2>
        <OpsConfigForm config={config} />
        <ConfirmDialog
          action={resetOpsConfigAction}
          triggerLabel="恢复默认告警配置"
          triggerClassName="btn quiet danger small"
          title="恢复默认告警配置"
          description="恢复后使用内置阈值，不会删除已有告警记录。"
          confirmLabel="确认恢复"
        />
      </section>

      <section className="panel">
        <h2>最近告警</h2>
        {alertLog.length === 0 ? (
          <p className="muted small">还没有发送过告警。</p>
        ) : (
          <ul className="maintain-list">
            {alertLog.map((entry) => (
              <li key={entry.key}>
                {new Date(entry.at).toLocaleString('zh-CN')} · {entry.key}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
