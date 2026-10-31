import Link from 'next/link'
import { redirect } from 'next/navigation'
import { listCollections } from '@repo-radar/core'
import { createCollectionAction } from '@/app/actions'
import { auth } from '@/auth'
import { getPool } from '@/lib/db'
import { sessionUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

export default async function CollectionsPage() {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')

  const collections = await listCollections(getPool(), Number(currentUser.id))

  return (
    <div className="page">
      <section className="feed-head">
        <div>
          <p className="eyebrow">收藏集</p>
          <h1>你的收藏</h1>
          <p className="feed-meta">把值得回看的项目收进集合，公开的集合可以分享给朋友。</p>
        </div>
      </section>

      <form className="panel" action={createCollectionAction}>
        <h2>新建收藏集</h2>
        <div className="collection-create">
          <label className="field">
            <span>名称</span>
            <input name="name" placeholder="例如：下次要试的 CLI 工具" />
          </label>
          <label className="field">
            <span>描述（可选）</span>
            <input name="description" placeholder="一句话说明这个集合的用途" />
          </label>
          <button className="btn solid" type="submit">
            创建
          </button>
        </div>
      </form>

      {collections.length === 0 ? (
        <div className="empty">
          <p>还没有收藏集。</p>
          <p className="small">建一个集合，然后在项目详情页点击「加入收藏集」。</p>
        </div>
      ) : (
        <div className="collection-grid">
          {collections.map((collection) => (
            <Link className="collection-card" href={`/collections/${collection.id}`} key={collection.id}>
              <div className="collection-card-head">
                <h2>{collection.name}</h2>
                <span className={collection.isPublic ? 'chip verified' : 'chip subtle'}>
                  {collection.isPublic ? '公开' : '私密'}
                </span>
              </div>
              {collection.description ? <p className="muted small">{collection.description}</p> : null}
              <p className="collection-meta">{collection.itemCount} 个项目</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
