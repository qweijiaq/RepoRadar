import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  canManageTeam,
  findCollection,
  findCollectionAccess,
  findPublicCollectionBySlug,
  findRepoByFullName,
  listCollectionItems,
  loadHandledState,
  getPool,
  recordPublicCollectionView,
  resolveBaseUrl,
} from '@repo-radar/core'
import { CopyButton } from '@/components/ui/CopyButton'
import {
  deleteCollectionAction,
  removeCollectionItemAction,
  toggleCollectionPublicAction,
} from '@/app/actions'
import { auth } from '@/auth'
import { sessionUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

interface CollectionPageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ q?: string }>
}

export default async function CollectionDetailPage({ params, searchParams }: CollectionPageProps) {
  const { id } = await params
  const search = await searchParams
  const query = (search.q ?? '').trim().slice(0, 80)
  const numericId = Number(id)
  const collectionId = Number.isFinite(numericId) && numericId > 0 ? numericId : null

  const pool = getPool()
  const session = await auth()
  const currentUser = sessionUser(session)
  const collection = collectionId
    ? (currentUser
        ? await findCollectionAccess(pool, Number(currentUser.id), collectionId)
        : null) ?? (await findCollection(pool, collectionId))
    : await findPublicCollectionBySlug(pool, id)
  if (!collection) notFound()

  const isMember =
    Boolean(currentUser) &&
    (collection.userId === Number(currentUser?.id ?? 0) || collection.teamRole !== null)
  const canEdit = Boolean(currentUser) && collection.access !== 'read'
  const canDelete =
    collection.access === 'owner' ||
    Boolean(collection.teamRole && canManageTeam(collection.teamRole))
  if (!collection.isPublic && !isMember) notFound()

  const viewCount =
    !canEdit && collection.isPublic && collection.publicSlug
      ? (await recordPublicCollectionView(pool, collection.publicSlug)) ?? collection.viewCount
      : collection.viewCount
  const items = await listCollectionItems(pool, collection.id)
  const publicUrl =
    collection.isPublic && collection.publicSlug
      ? `${(await resolveBaseUrl(pool)).replace(/\/+$/, '')}/collections/${collection.publicSlug}`
      : null
  const repos = await Promise.all(items.map((item) => findRepoByFullName(pool, item.repoFullName)))
  const handled = currentUser ? await loadHandledState(pool, Number(currentUser.id)) : null
  function itemStatus(repoFullName: string): 'adopted' | 'rejected' | null {
    if (!handled) return null
    const repoKey = repoFullName.toLowerCase()
    if (handled.done.has(`gem:${repoKey}`)) return 'adopted'
    for (const [pair, status] of handled.outcomes) {
      if (pair.endsWith(`|${repoKey}`)) return status
    }
    if ([...handled.done].some((key) => key.startsWith('watch:') && key.endsWith(`:${repoKey}`))) {
      return 'adopted'
    }
    if ([...handled.dismissed].some((key) => key.startsWith('watch:') && key.endsWith(`:${repoKey}`))) {
      return 'rejected'
    }
    return null
  }
  const rows = items
    .map((item, index) => ({ item, repo: repos[index] }))
    .filter(({ item, repo }) => {
      if (!query) return true
      const needle = query.toLowerCase()
      return [item.repoFullName, item.note ?? '', repo?.summary ?? '', repo?.description ?? '']
        .join(' ')
        .toLowerCase()
        .includes(needle)
    })

  return (
    <div className="page">
      <p className="breadcrumb">
        <Link href="/feed?tab=collections">← 收藏集</Link>
      </p>

      <section className="feed-head">
        <div>
          <p className="eyebrow">收藏集</p>
          <h1>{collection.name}</h1>
          <p className="feed-meta">
            {collection.itemCount} 个项目 · {collection.isPublic ? '公开' : '私密'} ·{' '}
            {collection.teamName ? `团队 · ${collection.teamName} · ` : ''}
            {collection.access === 'read' ? '只读 · ' : ''}
            {collection.isPublic ? `${viewCount} 次浏览 · ` : ''}
            {new Date(collection.createdAt).toLocaleDateString('zh-CN')}
          </p>
          {collection.description ? <p className="muted">{collection.description}</p> : null}
          {publicUrl ? (
            <p className="muted small">
              公开链接：<code>/collections/{collection.publicSlug}</code>{' '}
              <CopyButton value={publicUrl} label="复制" className="btn quiet small" />
            </p>
          ) : null}
        </div>
        {canEdit ? (
          <div className="feed-actions">
            <form action={toggleCollectionPublicAction}>
              <input type="hidden" name="collectionId" value={collection.id} />
              <button className="btn small" type="submit">
                {collection.isPublic ? '设为私密' : '设为公开'}
              </button>
            </form>
            {canDelete ? (
              <form action={deleteCollectionAction}>
                <input type="hidden" name="collectionId" value={collection.id} />
                <button className="btn small danger" type="submit">
                  删除
                </button>
              </form>
            ) : null}
          </div>
        ) : null}
      </section>

      {items.length > 0 ? (
        <form action={`/collections/${id}`} method="get" className="feed-search">
          <input
            className="input"
            type="search"
            name="q"
            defaultValue={query}
            placeholder="搜索集合里的项目或备注"
            spellCheck={false}
          />
          <button className="btn small" type="submit">
            搜索
          </button>
          {query ? (
            <Link className="btn quiet small" href={`/collections/${id}`}>
              清除
            </Link>
          ) : null}
        </form>
      ) : null}

      {items.length === 0 ? (
        <div className="empty">
          <p>这个集合还是空的。</p>
          <p className="small">去项目详情页，点击「加入收藏集」。</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="empty">
          <p>没有匹配的项目。</p>
          <Link className="btn small" href={`/collections/${id}`}>
            清除搜索
          </Link>
        </div>
      ) : (
        <details
          className="collapsible-section"
          open={rows.length <= 10 || Boolean(query)}
        >
          <summary className="collapsible-summary">
            <span>集合项目</span>
            <span className="muted small">{rows.length} 个</span>
          </summary>
        <ul className="collection-items" id="items">
          {rows.map(({ item, repo }) => {
            return (
              <li key={item.repoFullName} className="collection-item">
                <div>
                  <div className="collection-item-head">
                    {repo ? (
                      <Link className="repo-name" href={`/r/${repo.owner}/${repo.name}`}>
                        {repo.fullName}
                      </Link>
                    ) : (
                      <span className="repo-name">{item.repoFullName}</span>
                    )}
                    {itemStatus(item.repoFullName) === 'adopted' ? (
                      <span className="chip verified">已接入</span>
                    ) : null}
                    {itemStatus(item.repoFullName) === 'rejected' ? (
                      <span className="chip subtle">不感兴趣</span>
                    ) : null}
                  </div>
                  <p className="muted small">{repo?.summary ?? repo?.description ?? '暂无摘要'}</p>
                  {item.note ? <p className="repo-reason">备注：{item.note}</p> : null}
                </div>
                {canEdit ? (
                  <form action={removeCollectionItemAction}>
                    <input type="hidden" name="collectionId" value={collection.id} />
                    <input type="hidden" name="repo" value={item.repoFullName} />
                    <input type="hidden" name="returnTo" value={`/collections/${id}#items`} />
                    <button className="btn quiet small" type="submit">
                      移除
                    </button>
                  </form>
                ) : null}
              </li>
            )
          })}
        </ul>
        </details>
      )}
    </div>
  )
}
