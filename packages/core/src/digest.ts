function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export interface DigestItem {
  fullName: string
  htmlUrl: string
  stars: number
  language: string | null
  summary: string | null
  reason: string | null
  score: number
}

export interface DigestOptions {
  items: DigestItem[]
  userName: string
  date?: Date
  baseUrl?: string
}

function digestDate(options: DigestOptions): string {
  return (options.date ?? new Date()).toISOString().slice(0, 10)
}

export function renderDigestMarkdown(options: DigestOptions): string {
  const lines: string[] = [
    `# RepoRadar 精选 — ${options.userName}`,
    '',
    `${digestDate(options)} · 共 ${options.items.length} 个项目`,
    '',
  ]

  options.items.forEach((item, index) => {
    lines.push(`## ${index + 1}. [${item.fullName}](${item.htmlUrl})`)
    lines.push(`★ ${item.stars} · ${item.language ?? '未知语言'} · 匹配分 ${item.score.toFixed(2)}`)
    if (item.summary) lines.push('', item.summary)
    if (item.reason) lines.push('', `> ${item.reason}`)
    if (options.baseUrl) lines.push('', `[在 RepoRadar 中查看](${options.baseUrl}/r/${item.fullName})`)
    lines.push('')
  })

  return `${lines.join('\n').trimEnd()}\n`
}

export function renderDigestHtml(options: DigestOptions): string {
  const cards = options.items
    .map((item) => {
      const title = escapeHtml(item.fullName)
      const summary = item.summary ? escapeHtml(item.summary) : ''
      const reason = item.reason ? escapeHtml(item.reason) : ''
      const detailUrl = options.baseUrl
        ? `${options.baseUrl}/r/${item.fullName}`
        : item.htmlUrl

      return `    <div style="border:1px solid #232b3a;border-radius:12px;padding:16px;margin-bottom:12px;background:#121620;">
      <div style="font-size:15px;">
        <a href="${escapeHtml(item.htmlUrl)}" style="color:#6ea8fe;font-weight:600;text-decoration:none;">${title}</a>
        <span style="color:#8b95a7;float:right;">★ ${item.stars}</span>
      </div>
      <div style="color:#8b95a7;font-size:12px;margin-top:4px;">${escapeHtml(item.language ?? '未知语言')} · 匹配分 ${item.score.toFixed(2)}</div>
      ${summary ? `<p style="color:#c3cbdb;font-size:14px;margin:10px 0 0;">${summary}</p>` : ''}
      ${reason ? `<p style="color:#8b95a7;font-size:13px;margin:8px 0 0;">为什么：${reason}</p>` : ''}
      <p style="margin:10px 0 0;"><a href="${escapeHtml(detailUrl)}" style="color:#6ea8fe;font-size:13px;text-decoration:none;">在 RepoRadar 中查看 →</a></p>
    </div>`
    })
    .join('\n')

  return `<!doctype html>
<html>
<body style="margin:0;padding:24px;background:#0a0c11;color:#e7ecf6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:640px;margin:0 auto;">
    <h1 style="font-size:22px;margin:0 0 6px;">RepoRadar 精选 — ${escapeHtml(options.userName)}</h1>
    <p style="color:#8b95a7;margin:0 0 24px;font-size:13px;">${digestDate(options)} · 共 ${options.items.length} 个项目</p>
${cards}
  </div>
</body>
</html>`
}
