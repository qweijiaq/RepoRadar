import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { findCollection, findRepoByFullName, listCollectionItems } from '@repo-radar/core'
import {
  deleteCollectionAction,
  removeCollectionItemAction,
  toggleCollectionPublicAction,
} from '@/app/actions'
import { auth } from '@/auth'
import { getPool } from '@/lib/db'
import { sessionUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

interface CollectionPageProps {
  params: Promise<{ id: string }>
}

export default async function CollectionDetailPage({ params }: CollectionPageProps) {
  const { id } = await params
  const collectionId = Number(id)
  if (!Number.isFinite(collectionId)) notFound()

  const pool = getPool()
  const collection = await findCollection(pool, collectionId)
  if (!collection) notFound()

  const session = await auth()
  const currentUser = sessionUser(session)
  const isOwner = currentUser?.id === String(collection.userId)
  if (!collection.isPublic && !isOwner) notFound()

  const items = await listCollectionItems(pool, collectionId)
  const repos = await Promise.all(items.map((item) => findRepoByFullName(pool, item.repoFullName)))

  return (
    <div className="page">
      <p className="breadcrumb">
        <Link href="/collections">← 收藏集</Link>
      </p>

      <section className="feed-head">
        <div>
          <p className="eyebrow">收藏集</p>
          <h1>{collection.name}</h1>
          <p className="feed-meta">
            {collection.itemCount} 个项目 · {collection.isPublic ? '公开' : '私密'} ·{' '}
            {new Date(collection.createdAt).toLocaleDateString('zh-CN')}
          </p>
          {collection.description ? <p className="muted">{collection.description}</p> : null}
        </div>
        {isOwner ? (
          <div className="feed-actions">
            <form action={toggleCollectionPublicAction}>
              <input type="hidden" name="collectionId" value={collection.id} />
              <button className="btn small" type="submit">
                {collection.isPublic ? '设为私密' : '设为公开'}
              </button>
            </form>
            <form action={deleteCollectionAction}>
              <input type="hidden" name="collectionId" value={collection.id} />
              <button className="btn small danger" type="submit">
                删除
              </button>
            </form>
          </div>
        ) : null}
      </section>

      {items.length === 0 ? (
        <div className="empty">
          <p>这个集合还是空的。</p>
          <p className="small">去项目详情页，点击「加入收藏集」。</p>
        </div>
      ) : (
        <ul className="collection-items">
          {items.map((item, index) => {
            const repo = repos[index]
            return (
              <li key={item.repoFullName} className="collection-item">
                <div>
                  {repo ? (
                    <Link className="repo-name" href={`/r/${repo.owner}/${repo.name}`}>
                      {repo.fullName}
                    </Link>
                  ) : (
                    <span className="repo-name">{item.repoFullName}</span>
                  )}
                  <p className="muted small">{repo?.summary ?? repo?.description ?? '暂无摘要'}</p>
                  {item.note ? <p className="repo-reason">备注：{item.note}</p> : null}
                </div>
                {isOwner ? (
                  <form action={removeCollectionItemAction}>
                    <input type="hidden" name="collectionId" value={collection.id} />
                    <input type="hidden" name="repo" value={item.repoFullName} />
                    <input type="hidden" name="returnTo" value={`/collections/${collection.id}`} />
                    <button className="btn quiet small" type="submit">
                      移除
                    </button>
                  </form>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
