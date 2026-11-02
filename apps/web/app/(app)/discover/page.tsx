import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getPool, loadConfig, loadStoredLlmConfig, searchByIntent } from '@repo-radar/core'
import { auth } from '@/auth'
import { sessionUser } from '@/lib/session'

export const dynamic = 'force-dynamic'
export const metadata = { title: '意图搜索 — RepoRadar' }

interface DiscoverPageProps {
  searchParams: Promise<{ q?: string }>
}

const EXAMPLES = [
  '能解析 PDF 表格、TypeScript、还在维护的库',
  '轻量的 Node CLI 参数解析，不要重型框架',
  '支持 Postgres 的 TypeScript ORM，最近半年有更新',
]

export default async function DiscoverPage({ searchParams }: DiscoverPageProps) {
  const params = await searchParams
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')

  const query = (params.q ?? '').trim().slice(0, 300)
  const pool = getPool()
  let result: Awaited<ReturnType<typeof searchByIntent>> | null = null
  let error: string | null = null

  if (query) {
    const llm = loadConfig().llm ?? (await loadStoredLlmConfig(pool))
    if (!llm) {
      error = '还没有配置 AI 模型，请先到设置页配置后再搜索。'
    } else {
      try {
        result = await searchByIntent(pool, llm, query, { limit: 6 })
      } catch (cause) {
        error = cause instanceof Error ? cause.message.slice(0, 200) : '搜索失败，请稍后重试'
      }
    }
  }

  return (
    <div className="page">
      <section className="feed-head">
        <div>
          <p className="eyebrow">发现</p>
          <h1>用一句话找到你想要的仓库</h1>
          <p className="feed-meta">
            AI 会理解你的需求，拆成关键词、语言和必须能力，再做关键词 + 语义混合召回，最后解释每个结果为什么匹配。
          </p>
        </div>
      </section>

      <form className="discover-form" action="/discover" method="get">
        <input
          className="input"
          name="q"
          defaultValue={query}
          placeholder="例如：能解析 PDF 表格、TypeScript、还在维护的库"
          maxLength={300}
          required
        />
        <button className="btn solid" type="submit">
          AI 搜索
        </button>
      </form>

      {!query ? (
        <section className="panel">
          <h2>试试这些</h2>
          <ul className="maintain-list">
            {EXAMPLES.map((example) => (
              <li key={example}>
                <Link href={`/discover?q=${encodeURIComponent(example)}`}>{example}</Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {error ? <div className="notice">{error}</div> : null}

      {result ? (
        <>
          <section className="panel">
            <h2>结论</h2>
            <p>{result.answer || '找到了这些候选。'}</p>
            <div className="discover-intent">
              {result.intent.keywords.map((keyword) => (
                <span className="chip subtle" key={keyword}>
                  {keyword}
                </span>
              ))}
              {result.intent.language ? (
                <span className="chip subtle">{result.intent.language}</span>
              ) : null}
              {result.intent.minStars > 0 ? (
                <span className="chip subtle">★ ≥ {result.intent.minStars}</span>
              ) : null}
              {result.intent.topics.map((topic) => (
                <span className="chip subtle" key={topic}>
                  #{topic}
                </span>
              ))}
              {result.cached ? <span className="muted small">缓存结果</span> : null}
            </div>
            {result.intent.mustHave.length > 0 ? (
              <p className="muted small">必须能力：{result.intent.mustHave.join('；')}</p>
            ) : null}
          </section>

          {result.results.length === 0 ? (
            <section className="panel">
              <p className="muted">没有找到足够匹配的仓库。试试放宽语言或热度限制，或换一种说法。</p>
            </section>
          ) : (
            <div className="discover-results">
              {result.results.map((hit) => (
                <article className="panel" key={hit.repo.fullName}>
                  <header className="compare-head">
                    <Link className="repo-name" href={`/r/${hit.repo.fullName}`}>
                      {hit.repo.fullName}
                    </Link>
                    <span className="chip used">{hit.fit}</span>
                  </header>
                  <p className="muted small">
                    {hit.repo.language ?? 'Unknown'} · ★ {hit.repo.stars.toLocaleString('en-US')}
                    {hit.repo.topics.length > 0
                      ? ` · ${hit.repo.topics.slice(0, 4).map((topic) => `#${topic}`).join(' ')}`
                      : ''}
                  </p>
                  <p>{hit.why}</p>
                  <p className="muted small">缺口 / 风险：{hit.gaps}</p>
                  <div className="feed-actions">
                    <Link className="btn quiet small" href={`/r/${hit.repo.fullName}`}>
                      看详情
                    </Link>
                    <Link
                      className="btn quiet small"
                      href={`/compare?project=${encodeURIComponent(hit.repo.fullName)}`}
                    >
                      和其他方案对比
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  )
}
