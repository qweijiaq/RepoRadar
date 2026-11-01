import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { buildPatchBrief, buildPullRequestBrief, findPatchDraft, getPool } from '@repo-radar/core'
import { CopyIntegrationButton } from '@/app/(app)/workbench/integrations/copy-button'
import { auth } from '@/auth'
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
  const pullRequestBrief = buildPullRequestBrief(patch)
  const isTrial = patch.kind === 'integration'
  const isSwap = patch.kind === 'swap'
  const backHref = isTrial
    ? '/workbench/integrations'
    : isSwap
      ? '/workbench/swap'
      : patch.issueNumber
        ? `/issue-plan?repo=${encodeURIComponent(patch.repo)}&number=${patch.issueNumber}`
        : '/workbench/maintain'
  const backLabel = isTrial
    ? '← 返回接入建议'
    : isSwap
      ? '← 返回换库沙盘'
      : '← 返回 Issue 修复方案'
  const kindLabel = isTrial ? '接入预演' : isSwap ? '换库预演' : '修复补丁'

  return (
    <div className="page narrow">
      <p className="muted small">
        <Link href={backHref}>{backLabel}</Link>
      </p>
      <section className="feed-head">
        <div>
          <p className="eyebrow">{kindLabel}</p>
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
          <CopyIntegrationButton text={pullRequestBrief} label="复制 PR 描述" className="btn quiet small" />
          <a className="btn small" href={`/api/patches/${patch.id}`}>
            下载 .patch
          </a>
        </div>
      </section>

      {patch.status !== 'validated' ? (
        <div className="notice">
          这个补丁{patch.status === 'failed' ? '验证未通过' : '还是草稿'}。复制、下载或交给 AI 前请先仔细检查 diff 和验证结果。
        </div>
      ) : null}

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

      <section className="panel">
        <h2>PR 描述草稿</h2>
        <p className="muted small">
          提交前先人工 review diff。复制下面的标题和正文，到 GitHub 新建 PR 时粘贴；RepoRadar 不会自动推送或创建 PR。
        </p>
        <pre className="log-block">{pullRequestBrief}</pre>
      </section>

      <p className="muted small">
        补丁只保存在 RepoRadar，不会自动提交、推送或创建 PR。请先阅读 diff，在本地或沙箱中确认后再自行应用。
      </p>
    </div>
  )
}
