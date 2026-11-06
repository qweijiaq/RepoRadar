import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getPool, listPatchDrafts, listUserProjects } from '@repo-radar/core'
import { enqueueSwapTrialAction } from '@/app/(app)/jobs/enqueue'
import { QueryToast } from '@/components/ui/QueryToast'
import { auth } from '@/auth'
import { sessionUser } from '@/lib/session'

export const dynamic = 'force-dynamic'
export const metadata = { title: '换库预演 — RepoRadar' }

const STATUS_LABEL: Record<string, string> = {
  validated: '验证通过',
  failed: '验证未通过',
  draft: '草稿',
}

interface SwapPageProps {
  searchParams: Promise<{ error?: string }>
}

export default async function SwapPage({ searchParams }: SwapPageProps) {
  const params = await searchParams
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')

  const pool = getPool()
  const [projects, drafts] = await Promise.all([
    listUserProjects(pool, Number(currentUser.id)),
    listPatchDrafts(pool, Number(currentUser.id), { kind: 'swap', limit: 10 }),
  ])
  const defaultProject = projects[0]?.repoFullName ?? ''

  return (
    <div className="page">
      <section className="feed-head">
        <div>
          <p className="eyebrow">换库沙盘</p>
          <h1>把一个库换个实现，先在沙箱里试一遍</h1>
          <p className="feed-meta">
            填项目和包名，模型会生成迁移补丁（换依赖、替换 import 和调用），在 Docker 沙箱里验证能否安装和构建。
            不会改动远端仓库，也不会自动提交。
          </p>
        </div>
      </section>

      <QueryToast
        code={params.error}
        messages={{
          invalid: '项目或包名格式不正确。',
          'need-token': '换库预演需要 GitHub 授权来读取仓库，请重新登录后再试。',
        }}
      />

      <section className="panel" id="swap-form">
        <h2>新建换库预演</h2>
        <form action={enqueueSwapTrialAction} className="swap-form">
          <label>
            项目
            <input className="input" name="project" list="swap-projects" defaultValue={defaultProject} required />
          </label>
          <datalist id="swap-projects">
            {projects.map((project) => (
              <option key={project.repoFullName} value={project.repoFullName} />
            ))}
          </datalist>
          <label>
            从（旧包名）
            <input className="input" name="from" placeholder="axios" required />
          </label>
          <label>
            到（新包名）
            <input className="input" name="to" placeholder="ofetch" required />
          </label>
          <label>
            目标文件（可选）
            <input className="input" name="file" placeholder="src/lib/http.ts" />
          </label>
          <label className="swap-mode">
            <input type="checkbox" name="mode" value="mechanical" /> 只做机械替换（不调用模型，
            适合 API 兼容的换库）
          </label>
          <button className="btn solid" type="submit">
            生成换库补丁
          </button>
        </form>
      </section>

      <section className="panel">
        <h2>最近的换库预演</h2>
        {drafts.length === 0 ? (
          <p className="muted">还没有记录。生成一次后，这里会显示补丁和构建结果。</p>
        ) : (
          <ul className="maintain-list">
            {drafts.map((draft) => (
              <li key={draft.id}>
                <Link href={`/patch/${draft.id}`}>{draft.title}</Link>{' '}
                <span className="chip subtle">{STATUS_LABEL[draft.status] ?? draft.status}</span>{' '}
                <span className="muted small">
                  {new Date(draft.createdAt).toLocaleString('zh-CN')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
