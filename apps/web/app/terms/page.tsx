export const metadata = { title: '服务条款 — RepoRadar' }

export default function TermsPage() {
  return (
    <div className="page narrow">
      <p className="eyebrow">条款</p>
      <h1>服务条款</h1>
      <p className="muted small">这是自托管部署的条款模板，公开运营前请根据实际服务补充并请法律专业人士审核。</p>

      <section className="panel">
        <h2>服务</h2>
        <p className="muted">
          RepoRadar 是一个开源项目发现、维护和 AI 辅助工具。自托管实例由部署方运营；仓库代码按 Apache-2.0 提供，不附带任何明示或暗示的担保。
        </p>
      </section>

      <section className="panel">
        <h2>你的责任</h2>
        <ul className="maintain-list">
          <li>只连接你有权访问的 GitHub 账号和仓库。</li>
          <li>妥善保管模型、邮件和推送凭据，不要在使用共享实例时提交他人的私密信息。</li>
          <li>遵守 GitHub、模型服务商、邮件服务商和托管平台的条款与速率限制。</li>
          <li>不要使用本服务生成或传播违法、侵权、恶意或误导性内容。</li>
        </ul>
      </section>

      <section className="panel">
        <h2>AI 输出</h2>
        <p className="muted">
          AI 生成的分析、补丁和升级建议可能不准确。应用补丁前请人工审阅；RepoRadar 不会自动提交、推送或创建 PR。补丁构建在 Docker 沙箱中执行，仍应将 worker 主机视为高信任环境。
        </p>
      </section>

      <section className="panel">
        <h2>终止与数据</h2>
        <p className="muted">
          你可以随时在设置页删除账号。部署方可以在滥用、违法或安全风险出现时暂停实例。数据导出和删除方式见隐私说明。
        </p>
      </section>
    </div>
  )
}
