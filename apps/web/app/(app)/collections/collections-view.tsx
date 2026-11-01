import Link from 'next/link'
import { listCollections, getPool } from '@repo-radar/core'
import { createCollectionAction } from '@/app/actions'

/** 收藏集列表，嵌入雷达页的「收藏」标签；详情页仍使用 /collections/[id]。 */
export async function CollectionsView({ userId }: { userId: number }) {
  const collections = await listCollections(getPool(), userId)

  return (
    <>
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
    </>
  )
}
