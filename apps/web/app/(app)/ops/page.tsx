import Link from 'next/link'
import {
  loadAlertLog,
  loadOpsConfig,
  listAdminUserOverview,
  loadOpsMetrics,
  loadRecentFailures,
  renderPrometheus,
  runDoctor,
  getPool,
} from '@repo-radar/core'
import { resetOpsConfigAction } from '@/app/actions'
import { requireAdmin } from '@/lib/admin'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
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
  const [metrics, failures, config, alertLog, users, doctor] = await Promise.all([
    loadOpsMetrics(pool),
    loadRecentFailures(pool),
    loadOpsConfig(pool),
    loadAlertLog(pool),
    listAdminUserOverview(pool),
    runDoctor(pool),
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

      <section className="panel">
        <h2>验收检查</h2>
        <p className="muted small">
          只读检查数据库、迁移、候选池、模型、GitHub 授权、邮件和任务队列；不会发送邮件或调用模型。
        </p>
        <ul className="maintain-list">
          {doctor.map((item) => (
            <li key={item.id}>
              <span
                className={
                  item.level === 'ok'
                    ? 'chip verified'
                    : item.level === 'warn'
                      ? 'chip release'
                      : 'chip danger'
                }
              >
                {item.level === 'ok' ? '通过' : item.level === 'warn' ? '注意' : '失败'}
              </span>{' '}
              <strong>{item.title}</strong>
              <span className="muted small"> — {item.detail}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h2>用户概览</h2>
        <p className="muted small">
          共 {users.length} 个账号。这里只展示使用情况，不包含 token、邮件密码等凭据。
        </p>
        <div className="admin-user-table">
          <div className="admin-user-row admin-user-head">
            <span>账号</span>
            <span>画像</span>
            <span>任务</span>
            <span>30 天 tokens</span>
            <span>最近任务</span>
          </div>
          {users.map((user) => (
            <div className="admin-user-row" key={user.id}>
              <span className="admin-user-name">
                <a href={`https://github.com/${user.login}`} target="_blank" rel="noreferrer">
                  {user.login}
                </a>
                <small className="muted">
                  {user.notificationEmail || user.email || '无通知邮箱'} · 注册于{' '}
                  {new Date(user.createdAt).toLocaleDateString('zh-CN')}
                </small>
              </span>
              <span>
                {user.topicCount > 0 ? `${user.topicCount} 个主题` : '未建立'}
                <small className="muted">
                  {user.starsSyncedAt
                    ? `同步于 ${new Date(user.starsSyncedAt).toLocaleDateString('zh-CN')}`
                    : '未同步'}
                </small>
              </span>
              <span>
                {user.jobsTotal} 个
                <small className="muted">
                  运行 {user.jobsRunning} · 失败 {user.jobsFailed}
                </small>
              </span>
              <span>{user.tokens30d.toLocaleString('zh-CN')}</span>
              <span>
                {user.lastJobAt
                  ? new Date(user.lastJobAt).toLocaleString('zh-CN')
                  : '还没有任务'}
              </span>
            </div>
          ))}
        </div>
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
