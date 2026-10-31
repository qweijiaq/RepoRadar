import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { buildPatchBrief, findPatchDraft } from '@repo-radar/core'
import { CopyIntegrationButton } from '@/app/integrations/copy-button'
import { auth } from '@/auth'
import { getPool } from '@/lib/db'
import { sessionUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

interface PatchPageProps {
  params: Promise<{ id: string }>
}

const STATUS_LABEL: Record<string, string> = {
  validated: '已验证',
  failed: '验证未通过',
  draft: '草稿',
}

const BUILD_LABEL: Record<string, string> = {
  verified: '构建/测试通过',
  failed: '构建/测试失败',
  skipped: '已跳过构建',
  error: '构建验证出错',
}

export default async function PatchPage({ params }: PatchPageProps) {
  const { id: rawId } = await params
  const id = Number(rawId)
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')
  if (!Number.isFinite(id) || id <= 0) notFound()

  const patch = await findPatchDraft(getPool(), Number(currentUser.id), id)
  if (!patch) notFound()
  const brief = buildPatchBrief(patch)
  const issueHref = patch.issueNumber
    ? `/issue-plan?repo=${encodeURIComponent(patch.repo)}&number=${patch.issueNumber}`
    : '/maintain'

  return (
    <div className="page narrow">
      <p className="muted small">
        <Link href={issueHref}>← 返回 Issue 修复方案</Link>
      </p>
      <section className="feed-head">
        <div>
          <p className="eyebrow">修复补丁</p>
          <h1>
            {patch.repo}
            {patch.issueNumber ? ` #${patch.issueNumber}` : ''}
          </h1>
          <p className="feed-meta">
            {new Date(patch.createdAt).toLocaleString('zh-CN')} · {STATUS_LABEL[patch.status] ?? patch.status}
          </p>
        </div>
        <div className="feed-actions">
          <CopyIntegrationButton text={brief} label="复制补丁" className="btn small" />
          <a className="btn small" href={`/api/patches/${patch.id}`}>
            下载 .patch
          </a>
        </div>
      </section>

      {patch.summary ? (
        <section className="panel">
          <h2>改动说明</h2>
          <p className="muted">{patch.summary}</p>
        </section>
      ) : null}

      <section className="panel">
        <h2>验证结果</h2>
        {patch.validation ? (
          <>
            <ul className="maintain-list">
              <li>补丁应用：{patch.validation.applies ? '通过' : '失败'}</li>
              <li>构建 / 测试：{BUILD_LABEL[patch.validation.buildStatus] ?? patch.validation.buildStatus}</li>
              <li>改动文件：{patch.files.length > 0 ? patch.files.join('、') : '未识别'}</li>
            </ul>
            {patch.validation.commands.length > 0 ? (
              <pre className="log-block">{patch.validation.commands.join('\n')}</pre>
            ) : null}
            {patch.validation.logTail ? (
              <details>
                <summary className="muted small">查看验证日志</summary>
                <pre className="log-block">{patch.validation.logTail}</pre>
              </details>
            ) : null}
            {patch.validation.error ? <p className="job-error">{patch.validation.error}</p> : null}
          </>
        ) : (
          <p className="muted small">尚未验证。</p>
        )}
      </section>

      <section className="panel">
        <h2>补丁内容</h2>
        <pre className="patch-diff">{patch.patch}</pre>
      </section>

      <p className="muted small">
        补丁只保存在 RepoRadar，不会自动提交、推送或创建 PR。请先阅读 diff，在本地或沙箱中确认后再自行应用。
      </p>
    </div>
  )
}
