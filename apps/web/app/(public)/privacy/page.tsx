export const metadata = { title: '隐私说明 — RepoRadar' }

export default function PrivacyPage() {
  return (
    <div className="page narrow">
      <p className="eyebrow">隐私</p>
      <h1>隐私说明</h1>
      <p className="muted small">
        这是一份面向自托管部署的隐私说明模板。运营公开实例时，请根据实际部署、日志和第三方服务补充并请法律专业人士审核。
      </p>

      <section className="panel">
        <h2>我们保存什么</h2>
        <ul className="maintain-list">
          <li>GitHub 公开资料、star 列表、仓库和近期活动，用于生成口味画像和推荐。</li>
          <li>你在页面里配置的通知偏好、通知邮箱、项目、订阅、收藏和反馈。</li>
          <li>AI 生成内容、任务记录、Copilot 对话、补丁和使用量统计。</li>
          <li>为了后台同步而加密保存的 GitHub OAuth token、模型/SMTP 凭据和推送订阅。</li>
          <li>部署方的基础设施日志（访问日志、错误日志），具体取决于你的反向代理和托管平台。</li>
        </ul>
      </section>

      <section className="panel">
        <h2>用途与共享</h2>
        <p className="muted">
          数据用于个性化推荐、生成报告、发送你开启的通知、维护账号安全和排查故障。RepoRadar 会把必要的仓库/Issue 内容发送给你配置的模型服务商；邮件通过你配置的 SMTP 发送；推送通过浏览器 Push 服务发送；GitHub 数据来自 GitHub API。除此之外不会出售个人数据。
        </p>
      </section>

      <section className="panel">
        <h2>保存期限与删除</h2>
        <p className="muted">
          数据会保留到你主动删除账号。设置页可以导出全部个人数据，也可以永久删除账号及其派生数据。被删除的数据不会出现在后续推荐中；备份副本可能按运维方的备份周期短期保留。推送订阅凭据和 GitHub token 不会包含在导出文件中。
        </p>
      </section>

      <section className="panel">
        <h2>你的选择</h2>
        <ul className="maintain-list">
          <li>在设置页关闭邮件通知、浏览器推送或每周精选。</li>
          <li>填写单独的通知邮箱，或留空使用 GitHub 邮箱。</li>
          <li>导出数据或删除账号，见设置页「隐私与数据」。</li>
        </ul>
      </section>

      <p className="muted small">
        安全联系方式和数据控制者信息由部署方补充。仓库内的 SECURITY.md 说明了漏洞报告方式。
      </p>
    </div>
  )
}
