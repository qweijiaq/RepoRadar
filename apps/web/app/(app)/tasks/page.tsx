import Link from 'next/link'
import { redirect } from 'next/navigation'
import { countActiveJobs, listJobs, recoverStaleJobs, type JobKind, type JobStatus, getPool } from '@repo-radar/core'
import { auth } from '@/auth'
import { sessionUser } from '@/lib/session'
import { JobAutoRefresh } from './auto-refresh'
import { BulkJobActions } from './bulk-actions'
import { cancelJobAction, retryJobAction } from './actions'

export const dynamic = 'force-dynamic'

const KIND_LABEL: Record<JobKind, string> = {
  integration: '接入建议',
  maintainer: '维护周报',
  issue: '技术周报',
  discoverability: '曝光优化',
  comparison: '选型对比',
  'issue-plan': '修复方案',
  watch: '关注代理',
  activity: 'GitHub 动态',
  patch: '修复补丁',
  upgrade: '依赖升级',
  discover: '候选池刷新',
  enrich: '候选池富化',
  similar: '相似项目对比',
  'integration-trial': '接入预演',
  'swap-trial': '换库预演',
  'repo-profile': '功能画像',
}

const STATUS_LABEL: Record<JobStatus, string> = {
  queued: '排队中',
  running: '运行中',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

interface TasksPageProps {
  searchParams: Promise<{ job?: string; quota?: string; status?: string; page?: string }>
}

const PAGE_SIZE = 20
const STATUS_FILTERS: Array<{ value: JobStatus | null; label: string }> = [
  { value: null, label: '全部' },
  { value: 'queued', label: '排队中' },
  { value: 'running', label: '运行中' },
  { value: 'succeeded', label: '已完成' },
  { value: 'failed', label: '失败' },
  { value: 'cancelled', label: '已取消' },
]

function tasksHref(status: JobStatus | null, page: number): string {
  const params = new URLSearchParams()
  if (status) params.set('status', status)
  if (page > 1) params.set('page', String(page))
  const query = params.toString()
  return query ? `/tasks?${query}` : '/tasks'
}

export default async function TasksPage({ searchParams }: TasksPageProps) {
  const params = await searchParams
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')

  await recoverStaleJobs(getPool())
  const requestedStatus = params.status as JobStatus | undefined
  const status = requestedStatus && STATUS_FILTERS.some((item) => item.value === requestedStatus)
    ? requestedStatus
    : null
  const requestedPage = Number.parseInt(params.page ?? '', 10)
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1
  const [jobsPage, active] = await Promise.all([
    listJobs(getPool(), Number(currentUser.id), PAGE_SIZE + 1, {
      offset: (page - 1) * PAGE_SIZE,
      ...(status ? { status } : {}),
    }),
    countActiveJobs(getPool(), Number(currentUser.id)),
  ])
  const hasMore = jobsPage.length > PAGE_SIZE
  const jobs = jobsPage.slice(0, PAGE_SIZE)
  const highlight = Number(params.job)

  return (
    <div className="page narrow">
      <section className="feed-head">
        <div>
          <p className="eyebrow">后台任务</p>
          <h1>AI 任务中心</h1>
          <p className="feed-meta">
            任务在后台并行运行，可以继续浏览其他页面；完成后从这里或收件箱进入结果。
          </p>
        </div>
        {active > 0 ? <span className="chip used">运行中 {active}</span> : null}
      </section>

      {params.quota ? <div className="notice">{params.quota}</div> : null}

      <div className="filter-bar">
        <span className="filter-label">状态</span>
        {STATUS_FILTERS.map((item) => (
          <Link
            key={item.value ?? 'all'}
            className={status === item.value ? 'chip toggle active' : 'chip toggle'}
            href={tasksHref(item.value, 1)}
          >
            {item.label}
          </Link>
        ))}
        <span className="filter-count">第 {page} 页 · {jobs.length} 条</span>
      </div>

      {jobs.length > 0 ? <BulkJobActions /> : null}

      {jobs.length === 0 ? (
        <div className="empty">
          <p>{status ? '这个状态下还没有任务。' : '还没有后台任务。'}</p>
          <p className="small">在接入、维护、周报、曝光或关注页点击 AI 生成，就会出现在这里。</p>
        </div>
      ) : (
        <ul className="job-list">
          {jobs.map((job) => (
            <li
              className={`job-row${job.id === highlight ? ' highlight' : ''}`}
              key={job.id}
            >
              <label className="job-select">
                <input type="checkbox" name="jobIds" value={job.id} aria-label={`选择任务：${job.title}`} />
              </label>
              <div className="job-main">
                <div className="job-head">
                  <span className="chip subtle">{KIND_LABEL[job.kind]}</span>
                  <span className={`job-status ${job.status}`}>{STATUS_LABEL[job.status]}</span>
                  <span className="job-time">
                    {new Date(job.createdAt).toLocaleString('zh-CN')}
                  </span>
                </div>
                <p className="job-title">{job.title}</p>
                <span className="job-time">
                  尝试 {job.attempts}/{job.maxAttempts}
                </span>
                {job.status === 'running' && job.progress ? (
                  <p className="muted small">{job.progress}</p>
                ) : null}
                {(job.status === 'failed' || job.status === 'cancelled') && job.error ? (
                  <p className="job-error">{job.error}</p>
                ) : null}
                {job.status === 'succeeded' && job.result ? (
                  <p className="muted small">结果已生成，可以打开查看或从收件箱进入。</p>
                ) : null}
              </div>
              <div className="job-actions">
                {job.payload.origin ? (
                  <Link className="btn quiet small" href={job.payload.origin}>
                    返回
                  </Link>
                ) : null}
                {job.status === 'queued' || job.status === 'running' ? (
                  <form action={cancelJobAction}>
                    <input type="hidden" name="id" value={job.id} />
                    <button className="btn quiet danger small" type="submit">
                      取消
                    </button>
                  </form>
                ) : null}
                {job.status === 'failed' || job.status === 'cancelled' ? (
                  <form action={retryJobAction}>
                    <input type="hidden" name="id" value={job.id} />
                    <button className="btn small" type="submit">
                      重试
                    </button>
                  </form>
                ) : null}
                {job.result ? (
                  <Link className="btn solid small" href={job.result.href}>
                    {job.result.label}
                  </Link>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {page > 1 || hasMore ? (
        <div className="history-pagination">
          {page > 1 ? (
            <Link className="btn small" href={tasksHref(status, page - 1)} scroll={false}>
              上一页
            </Link>
          ) : null}
          <span className="muted small">第 {page} 页</span>
          {hasMore ? (
            <Link className="btn small" href={tasksHref(status, page + 1)} scroll={false}>
              下一页
            </Link>
          ) : null}
        </div>
      ) : null}

      {active > 0 ? <JobAutoRefresh /> : null}
    </div>
  )
}
