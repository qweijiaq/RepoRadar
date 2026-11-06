import Link from 'next/link'
import { notFound } from 'next/navigation'
import { findRepoByFullName, getPool, loadVerifications, resolveBaseUrl } from '@repo-radar/core'
import { CopyButton } from '@/components/ui/CopyButton'

export const dynamic = 'force-dynamic'

interface EvidencePageProps {
  params: Promise<{ owner: string; name: string }>
}

const STATUS_LABEL: Record<string, string> = {
  verified: '验证通过',
  failed: '构建失败',
  skipped: '已跳过',
  error: '验证出错',
}

export async function generateMetadata({ params }: EvidencePageProps) {
  const { owner, name } = await params
  const repo = await findRepoByFullName(getPool(), `${owner}/${name}`)
  if (!repo) return { title: '未找到项目 — RepoRadar' }
  return {
    title: `${repo.fullName} 验证证据 — RepoRadar`,
    description: `查看 ${repo.fullName} 在 RepoRadar 沙箱中的验证状态、命令和耗时。`,
    openGraph: {
      type: 'article',
      title: `${repo.fullName} 验证证据 — RepoRadar`,
      description: repo.summary ?? repo.description ?? undefined,
    },
  }
}

export default async function EvidencePage({ params }: EvidencePageProps) {
  const { owner, name } = await params
  const fullName = `${owner}/${name}`
  const pool = getPool()
  const repo = await findRepoByFullName(pool, fullName)
  if (!repo) notFound()

  const verifications = await loadVerifications(pool, fullName, 8)
  const latest = verifications[0] ?? null
  const baseUrl = (await resolveBaseUrl(pool)).replace(/\/+$/, '')
  const evidenceUrl = `${baseUrl}/evidence/${repo.owner}/${repo.name}`
  const badgeUrl = `${baseUrl}/api/badge/${repo.owner}/${repo.name}`
  const badgeMarkdown = `[![RepoRadar 验证](${badgeUrl})](${evidenceUrl})`

  return (
    <div className="page narrow">
      <p className="breadcrumb">
        <Link href={`/r/${repo.owner}/${repo.name}`}>← 返回项目详情</Link>
      </p>

      <section className="feed-head">
        <div>
          <p className="eyebrow">公开验证证据</p>
          <h1>{repo.fullName}</h1>
          <p className="feed-meta">
            {latest ? STATUS_LABEL[latest.status] ?? latest.status : '还没有验证记录'}
            {latest?.stack ? ` · ${latest.stack}` : ''}
            {latest?.verifiedAt ? ` · ${new Date(latest.verifiedAt).toLocaleString('zh-CN')}` : ''}
          </p>
        </div>
        <div className="feed-actions">
          <CopyButton value={evidenceUrl} label="复制证据链接" />
          <a className="btn quiet small" href={`https://github.com/${repo.fullName}`} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </div>
      </section>

      <section className="panel">
        <h2>验证徽章</h2>
        <p className="muted small">
          徽章会读取最近一次验证状态：通过、失败、跳过或未验证。可以放进 README，链接到本页。
        </p>
        <p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/badge/${repo.owner}/${repo.name}`} alt={`${repo.fullName} 验证徽章`} height={28} />
        </p>
        <pre className="log-block">{badgeMarkdown}</pre>
        <CopyButton value={badgeMarkdown} label="复制 Markdown" className="btn small" />
      </section>

      {latest ? (
        <section className="panel">
          <h2>最近一次验证</h2>
          <p className="muted">
            <span className={latest.status === 'verified' ? 'chip verified' : 'chip release'}>
              {STATUS_LABEL[latest.status] ?? latest.status}
            </span>
            {latest.stack ? ` · ${latest.stack}` : ''}
            {latest.durationMs !== null ? ` · ${(latest.durationMs / 1000).toFixed(1)}s` : ''}
            {latest.exitCode !== null ? ` · exit ${latest.exitCode}` : ''}
          </p>
          {latest.commitSha ? (
            <p className="muted small">
              commit <code>{latest.commitSha.slice(0, 12)}</code>
            </p>
          ) : null}
          <p className="muted small">
            日志不公开，避免泄露构建环境、路径或凭据；完整日志仅对验证执行者可见。
          </p>
          {latest.commands.length > 0 ? (
            <>
              <h3 className="maintain-subhead">执行命令</h3>
              <pre className="log-block">{latest.commands.join('\n')}</pre>
            </>
          ) : null}
        </section>
      ) : (
        <div className="empty">
          <p>还没有进入过沙箱验证。</p>
          <p className="small">
            运行 <code>pnpm radar verify --repo={repo.fullName}</code> 后，这里会出现可分享的验证结果。
          </p>
        </div>
      )}

      {verifications.length > 1 ? (
        <section className="panel">
          <h2>验证历史</h2>
          <ul className="timeline">
            {verifications.map((verification) => (
              <li key={verification.id}>
                <span className="timeline-date">
                  {verification.verifiedAt
                    ? new Date(verification.verifiedAt).toLocaleString('zh-CN')
                    : '未知时间'}
                </span>
                <span className={verification.status === 'verified' ? 'chip verified' : 'chip subtle'}>
                  {STATUS_LABEL[verification.status] ?? verification.status}
                </span>
                {verification.stack ? <span className="muted small"> · {verification.stack}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
