import Link from 'next/link'
import {
  loadAlertLog,
  loadLlmPrices,
  loadOpsConfig,
  listAdminUserOverview,
  loadJobFailureReasons,
  loadJobKindMetrics,
  loadOpsMetrics,
  loadRecentFailures,
  loadUsageByModel,
  priceUsage,
  renderPrometheus,
  runDoctor,
  totalCost,
  getPool,
} from '@repo-radar/core'
import { clearLlmPricesAction, resetOpsConfigAction, saveLlmPricesAction } from '@/app/actions'
import { requireAdmin } from '@/lib/admin'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { OpsConfigForm } from './ops-config-form'

export const dynamic = 'force-dynamic'
export const metadata = { title: '运维面板 — RepoRadar' }

const JOB_KIND_LABEL: Record<string, string> = {
  'integration-trial': '接入预演',
  'swap-trial': '换库预演',
  comparison: '选型对比',
  'issue-plan': 'Issue 方案',
  patch: '修复补丁',
  upgrade: '依赖升级',
  'repo-verify': '仓库验证',
  'watch-run': '关注扫描',
  'repo-patch': '仓库补丁',
}

function bytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`
}

interface OpsPageProps {
  searchParams: Promise<{ saved?: string; reset?: string; prices?: string }>
}

export default async function OpsPage({ searchParams }: OpsPageProps) {
  await requireAdmin()
  const params = await searchParams
  const pool = getPool()
  const [
    metrics,
    failures,
    config,
    alertLog,
    users,
    doctor,
    jobMetrics,
    failureReasons,
    llmPrices,
    usageByModel,
  ] = await Promise.all([
      loadOpsMetrics(pool),
      loadRecentFailures(pool),
      loadOpsConfig(pool),
      loadAlertLog(pool),
      listAdminUserOverview(pool),
      runDoctor(pool),
      loadJobKindMetrics(pool, 30),
      loadJobFailureReasons(pool, 30, 8),
      loadLlmPrices(pool),
      loadUsageByModel(pool, 30),
    ])

  const pricedUsage = priceUsage(usageByModel, llmPrices)
  const estimatedTotal = totalCost(pricedUsage)

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
          <a className="btn small" href="#prometheus">
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

      <section className="panel" id="prometheus">
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

      {params.prices === 'saved' ? (
        <div className="notice success">模型单价已保存。</div>
      ) : null}
      {params.prices === 'cleared' ? <div className="notice">模型单价已清空。</div> : null}
      {params.prices === 'invalid' ? (
        <div className="notice">单价需要是非负数字；输入和输出要么都填，要么都留空。</div>
      ) : null}

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

      <section className="panel">
        <h2>AI 任务质量（近 30 天）</h2>
        {jobMetrics.length === 0 ? (
          <p className="muted small">还没有任务记录。</p>
        ) : (
          <div className="admin-user-table">
            <div className="admin-user-row admin-user-head">
              <span>类型</span>
              <span>任务</span>
              <span>成功率</span>
              <span>耗时（均值 / P95）</span>
              <span>Tokens（输入 / 输出）</span>
            </div>
            {jobMetrics.map((row) => (
              <div className="admin-user-row" key={row.kind}>
                <span>{JOB_KIND_LABEL[row.kind] ?? row.kind}</span>
                <span>
                  {row.total} 个
                  <small className="muted">
                    成功 {row.succeeded} · 失败 {row.failed}
                    {row.running > 0 ? ` · 运行 ${row.running}` : ''}
                  </small>
                </span>
                <span>{row.successRate === null ? '—' : `${Math.round(row.successRate * 100)}%`}</span>
                <span>
                  {row.avgSeconds === null ? '—' : `${row.avgSeconds.toFixed(1)}s`}
                  <small className="muted">
                    P95 {row.p95Seconds === null ? '—' : `${row.p95Seconds.toFixed(1)}s`}
                  </small>
                </span>
                <span>
                  {row.promptTokens.toLocaleString('zh-CN')} / {row.completionTokens.toLocaleString('zh-CN')}
                  <small className="muted">{row.calls} 次调用</small>
                </span>
              </div>
            ))}
          </div>
        )}
        {failureReasons.length > 0 ? (
          <>
            <h3 className="maintain-subhead">失败原因 Top</h3>
            <ul className="maintain-list">
              {failureReasons.map((reason) => (
                <li key={`${reason.kind}:${reason.error}`}>
                  {JOB_KIND_LABEL[reason.kind] ?? reason.kind} · {reason.error}{' '}
                  <span className="muted small">×{reason.count}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        <p className="muted small">
          成功率只统计已结束的任务；耗时从开始执行算到完成。token 来自模型返回的 usage，未返回时为 0。
        </p>
      </section>

      <section className="panel">
        <h2>AI 成本（近 30 天）</h2>
        <p className="muted small">
          单价按每 100 万 token 的美元价格配置，只估算已配置单价的模型；实际账单可能因缓存或折扣有差异。
        </p>
        {pricedUsage.length === 0 ? (
          <p className="muted small">还没有模型调用记录。</p>
        ) : (
          <div className="admin-user-table">
            <div className="admin-user-row admin-user-head">
              <span>模型</span>
              <span>调用</span>
              <span>输入 / 输出 tokens</span>
              <span>单价（输入 / 输出）</span>
              <span>估算成本</span>
            </div>
            {pricedUsage.map((row) => (
              <div className="admin-user-row" key={row.model}>
                <span>{row.model}</span>
                <span>{row.calls} 次</span>
                <span>
                  {row.promptTokens.toLocaleString('zh-CN')} /{' '}
                  {row.completionTokens.toLocaleString('zh-CN')}
                </span>
                <span>
                  {row.price ? `$${row.price.input} / $${row.price.output}` : '未配置'}
                </span>
                <span>{row.cost === null ? '—' : `$${row.cost.toFixed(4)}`}</span>
              </div>
            ))}
            <div className="admin-user-row">
              <span>合计</span>
              <span />
              <span />
              <span />
              <span>${estimatedTotal.toFixed(4)}</span>
            </div>
          </div>
        )}

        <form action={saveLlmPricesAction}>
          <h3 className="maintain-subhead">模型单价（USD / 1M tokens）</h3>
          <div className="price-form">
            <div className="price-form-row muted small">
              <span>模型</span>
              <span>输入</span>
              <span>输出</span>
            </div>
            {pricedUsage.map((row) => (
              <div className="price-form-row" key={`price-${row.model}`}>
                <span>
                  {row.model}
                  <input type="hidden" name="model" value={row.model} />
                </span>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.0001"
                  name="input"
                  defaultValue={row.price?.input ?? ''}
                />
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.0001"
                  name="output"
                  defaultValue={row.price?.output ?? ''}
                />
              </div>
            ))}
            <div className="price-form-row">
              <input className="input" name="model" placeholder="新模型名" />
              <input
                className="input"
                type="number"
                min="0"
                step="0.0001"
                name="input"
                placeholder="输入"
              />
              <input
                className="input"
                type="number"
                min="0"
                step="0.0001"
                name="output"
                placeholder="输出"
              />
            </div>
          </div>
          <div className="feed-actions">
            <button className="btn solid" type="submit">
              保存单价
            </button>
          </div>
        </form>
        <form action={clearLlmPricesAction}>
          <button className="btn quiet small" type="submit">
            清空单价
          </button>
        </form>
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
