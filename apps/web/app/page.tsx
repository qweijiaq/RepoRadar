import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { sessionUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

const FEATURES = [
  {
    title: '懂你口味',
    body: '导入你的 GitHub star 生成口味画像，按主题和语言给每个候选项目打分，还可以排除不想看的方向。',
  },
  {
    title: '证据优先',
    body: '每条推荐都标注版本、日期和活跃度；高分项目可以进沙箱真实构建，附上日志与验证证据。',
  },
  {
    title: '情报而非列表',
    body: '把本周变化写成主题简报：发生了什么、和你有什么关系、要不要动手试，而不是再列一遍仓库。',
  },
  {
    title: '开源可自托管',
    body: '自带 GitHub 与模型凭据，数据留在自己的数据库里；支持 8 家服务商、45 个预置模型。',
  },
]

export default async function HomePage() {
  const session = await auth()
  if (sessionUser(session)) redirect('/feed')

  return (
    <div className="page">
      <section className="hero">
        <span className="enso" aria-hidden="true" />
        <p className="eyebrow">RepoRadar · 开源情报雷达</p>
        <h1>
          让好项目
          <br />
          自己找上门
        </h1>
        <p className="lead">
          从 GitHub 自动发现值得关注的开源项目，按你的 star 和兴趣个性化排序。每一条推荐都讲清楚它是什么、为什么值得看。
        </p>
        <div className="hero-actions">
          <Link className="btn solid" href="/login">
            开始使用
          </Link>
          <Link className="btn" href="/login">
            用 GitHub 登录
          </Link>
        </div>
      </section>

      <section className="feature-grid">
        {FEATURES.map((feature, index) => (
          <article className="feature" key={feature.title}>
            <span className="feature-no">{String(index + 1).padStart(2, '0')}</span>
            <h2>{feature.title}</h2>
            <p>{feature.body}</p>
          </article>
        ))}
      </section>
    </div>
  )
}
