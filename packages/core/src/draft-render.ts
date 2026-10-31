import type { IssueEvidence } from './issue.js'
import { ACTION_LABELS, type IssueDraft, type IssueDraftItem } from './narrative.js'

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function formatDate(evidence: IssueEvidence): string {
  return evidence.date.toISOString().slice(0, 10)
}

function profileChips(evidence: IssueEvidence): string[] {
  const profile = evidence.profile
  if (!profile) return []
  return [
    ...profile.topTopics.slice(0, 4).map((item) => `${item.topic} ${Math.round(item.weight * 100)}%`),
    ...profile.topLanguages.slice(0, 2).map((item) => `${item.language} ${Math.round(item.weight * 100)}%`),
  ]
}

export function renderDraftMarkdown(draft: IssueDraft, evidence: IssueEvidence): string {
  const lines: string[] = [`# RepoRadar 周报 · ${formatDate(evidence)}`, '']
  lines.push(`> 给 ${evidence.userName} 的个性化技术简报`)
  const chips = profileChips(evidence)
  if (chips.length > 0) lines.push(`> 画像摘要：${chips.join(' · ')}`)
  lines.push('', '## 本期结论', '')

  draft.summary.forEach((item, index) => lines.push(`${index + 1}. ${item}`))
  lines.push('')

  draft.themes.forEach((theme, index) => {
    lines.push(`## ${String(index + 1).padStart(2, '0')} ${theme.title}`, '', theme.judgment, '')
    for (const item of theme.items) {
      lines.push(`### ${item.name}`, '')
      lines.push(`- **变化**：${item.change}`)
      lines.push(`- **证据**：${item.evidence}`)
      lines.push(`- **对你的意义**：${item.relevance}`)
      lines.push(`- **行动**：**${ACTION_LABELS[item.action]}**${item.cost ? ` ${item.cost}` : ''}`)
      lines.push('')
    }
  })

  if (draft.ignore.length > 0) {
    lines.push('## 本周可以忽略', '')
    for (const entry of draft.ignore) {
      lines.push(`- ${entry.repo ? `**${entry.repo}**：` : ''}${entry.reason}`)
    }
    lines.push('')
  }

  if (draft.next.length > 0) {
    lines.push('## 下期想看什么？', '')
    for (const item of draft.next) lines.push(`- ${item}`)
    lines.push('')
  }

  lines.push('> 本稿由 LLM 基于真实证据生成，建议人工复核后发布。')
  return `${lines.join('\n').trimEnd()}\n`
}

const NEWSLETTER_CSS = `
  :root { color-scheme: dark; --bg:#0a0c11; --panel:#121620; --panel-2:#171c28; --border:#232b3a; --text:#e7ecf6; --muted:#8b95a7; --accent:#6ea8fe; --accent-2:#a78bfa; }
  * { box-sizing: border-box; }
  body { margin:0; background: radial-gradient(900px 420px at 12% -8%, rgba(110,168,254,.16), transparent 60%), radial-gradient(760px 380px at 92% 0%, rgba(167,139,250,.12), transparent 55%), var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Segoe UI", Roboto, sans-serif; line-height:1.75; -webkit-font-smoothing: antialiased; }
  .wrap { max-width:780px; margin:0 auto; padding:56px 24px 80px; }
  .brand { display:flex; align-items:center; gap:10px; font-weight:700; letter-spacing:.3px; }
  .dot { width:12px; height:12px; border-radius:50%; background: conic-gradient(from 200deg, var(--accent), var(--accent-2), var(--accent)); box-shadow:0 0 16px rgba(110,168,254,.8); }
  .issue { margin-left:auto; font-size:13px; color:var(--muted); border:1px solid var(--border); border-radius:999px; padding:3px 12px; }
  h1 { font-size:38px; line-height:1.15; letter-spacing:-1px; margin:36px 0 14px; }
  .meta { color:var(--muted); font-size:14px; margin-bottom:8px; }
  .chips { display:flex; flex-wrap:wrap; gap:6px; margin-top:12px; }
  .chip { font-size:12px; color:#a8c6ff; border:1px solid rgba(110,168,254,.35); background:rgba(110,168,254,.08); border-radius:999px; padding:2px 10px; }
  .summary { margin:32px 0 44px; padding:26px 26px 10px; border:1px solid var(--border); border-radius:18px; background:linear-gradient(180deg, rgba(23,28,40,.85), rgba(18,22,32,.65)); }
  .summary h2 { margin:0 0 14px; font-size:16px; letter-spacing:.4px; color:var(--muted); text-transform:uppercase; }
  .summary ol { margin:0; padding-left:20px; }
  .summary li { margin-bottom:12px; }
  section { margin:52px 0; }
  .sec-head { display:flex; align-items:baseline; gap:14px; border-bottom:1px solid var(--border); padding-bottom:12px; margin-bottom:22px; }
  .sec-no { font-size:30px; font-weight:800; color:var(--accent); letter-spacing:-1px; }
  .sec-head h2 { margin:0; font-size:23px; letter-spacing:-.4px; }
  .lead { color:#c3cbdb; font-size:16px; }
  .item { margin:22px 0; padding:20px 22px; border:1px solid var(--border); border-left:3px solid rgba(110,168,254,.55); border-radius:14px; background:rgba(18,22,32,.72); }
  .item h3 { margin:0 0 14px; font-size:18px; }
  .item .stars { color:var(--muted); font-size:13px; font-weight:400; margin-left:6px; }
  .row { display:grid; grid-template-columns:82px 1fr; gap:10px; padding:5px 0; font-size:14.5px; }
  .row .k { color:var(--muted); }
  .row .v { color:#c9d2e2; }
  .action { display:inline-flex; align-items:center; gap:6px; padding:2px 10px; border-radius:999px; font-size:12.5px; font-weight:600; }
  .action.try { color:#9df0bb; background:rgba(74,222,128,.1); border:1px solid rgba(74,222,128,.4); }
  .action.watch { color:#ffe2a1; background:rgba(255,215,137,.08); border:1px solid rgba(255,215,137,.35); }
  .action.ignore { color:#b9c2d4; background:rgba(139,149,167,.1); border:1px solid var(--border); }
  .ignore-list { margin:0; padding:0; list-style:none; }
  .ignore-list li { padding:14px 0; border-bottom:1px solid var(--border); font-size:14.5px; }
  .ignore-list li:last-child { border-bottom:0; }
  .ignore-list strong { color:#fff; }
  .ignore-list span { color:var(--muted); }
  .next { margin-top:40px; padding:22px 24px; border:1px solid var(--border); border-radius:16px; background:rgba(18,22,32,.72); }
  .next h2 { margin:0 0 10px; font-size:17px; }
  .next ul { margin:0; padding-left:18px; color:#c3cbdb; }
  .next li { margin-bottom:6px; }
  footer { margin-top:48px; padding-top:20px; border-top:1px solid var(--border); color:var(--muted); font-size:13px; }
  footer p { margin:6px 0; }
  a { color:var(--accent); text-decoration:none; }
  @media (max-width:640px) { .wrap { padding:32px 16px 56px; } h1 { font-size:29px; } .row { grid-template-columns:72px 1fr; } .sec-head h2 { font-size:20px; } }
`

function renderItemHtml(item: IssueDraftItem): string {
  const actionClass = item.action
  return `    <div class="item">
      <h3>${escapeHtml(item.name)} <span class="stars">${escapeHtml(item.repo)}</span></h3>
      <div class="row"><span class="k">变化</span><span class="v">${escapeHtml(item.change)}</span></div>
      <div class="row"><span class="k">证据</span><span class="v">${escapeHtml(item.evidence)}</span></div>
      <div class="row"><span class="k">对你的意义</span><span class="v">${escapeHtml(item.relevance)}</span></div>
      <div class="row"><span class="k">行动</span><span class="v"><span class="action ${actionClass}">${ACTION_LABELS[item.action]}</span>${item.cost ? ` ${escapeHtml(item.cost)}` : ''}</span></div>
    </div>`
}

export function renderDraftHtml(draft: IssueDraft, evidence: IssueEvidence): string {
  const chips = profileChips(evidence)
    .map((chip) => `<span class="chip">${escapeHtml(chip)}</span>`)
    .join('\n        ')

  const summary = draft.summary.map((item) => `      <li>${escapeHtml(item)}</li>`).join('\n')

  const themes = draft.themes
    .map((theme, index) => {
      const items = theme.items.map(renderItemHtml).join('\n')
      return `  <section>
    <div class="sec-head"><span class="sec-no">${String(index + 1).padStart(2, '0')}</span><h2>${escapeHtml(theme.title)}</h2></div>
    <p class="lead">${escapeHtml(theme.judgment)}</p>
${items}
  </section>`
    })
    .join('\n\n')

  const ignore = draft.ignore.length
    ? `  <section>
    <div class="sec-head"><span class="sec-no">${String(draft.themes.length + 1).padStart(2, '0')}</span><h2>本周可以忽略</h2></div>
    <ul class="ignore-list">
${draft.ignore
  .map((entry) => `      <li>${entry.repo ? `<strong>${escapeHtml(entry.repo)}</strong> ` : ''}<span>${escapeHtml(entry.reason)}</span></li>`)
  .join('\n')}
    </ul>
  </section>`
    : ''

  const next = draft.next.length
    ? `  <div class="next">
    <h2>下期想看什么？</h2>
    <ul>
${draft.next.map((item) => `      <li>${escapeHtml(item)}</li>`).join('\n')}
    </ul>
  </div>`
    : ''

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>RepoRadar 周报 · ${escapeHtml(draft.title)}</title>
<style>${NEWSLETTER_CSS}</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="brand"><span class="dot"></span> RepoRadar <span class="issue">周报</span></div>
    <h1>${escapeHtml(draft.title)}</h1>
    <div class="meta">${formatDate(evidence)} · 给 ${escapeHtml(evidence.userName)} 的个性化技术简报</div>
    <div class="chips">
        ${chips}
    </div>
  </header>

  <div class="summary">
    <h2>本期结论 · 30 秒</h2>
    <ol>
${summary}
    </ol>
  </div>

${themes}

${ignore}

${next}

  <footer>
    <p>RepoRadar · 懂你口味的开源项目雷达</p>
    <p>本稿由 LLM 基于真实证据生成，建议人工复核后发布。</p>
  </footer>
</div>
</body>
</html>`
}
