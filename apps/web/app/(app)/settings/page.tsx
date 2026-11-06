import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  LLM_PROVIDERS,
  GitHubManageError,
  envLlmSummary,
  fetchTokenScopes,
  getAuthenticatedLogin,
  hasDeleteRepoScope,
  hasRepoScope,
  findLlmProvider,
  loadDiscoveryStatus,
  loadMailStatus,
  runDoctor,
  loadQuotaConfig,
  loadQuotaUsage,
  loadRetentionConfig,
  loadRetentionLastRun,
  loadStoredLlmStatus,
  loadSubscriptions,
  loadUsageSummary,
  listRadarSnapshots,
  resolveBaseUrlStatus,
  getPool,
  countPushSubscriptions,
  countPendingDeliveries,
} from '@repo-radar/core'
import {
  addSubscriptionAction,
  clearLlmConfigAction,
  clearOAuthConfigAction,
  loadDemoTasteAction,
  removeSubscriptionAction,
  resyncStarsAction,
  revokeRadarShareAction,
  clearMailConfigAction,
  clearGithubWebhookSecretAction,
  resetQuotaConfigAction,
  resetRetentionConfigAction,
  runRetentionCleanupAction,
  saveBaseUrlAction,
  saveLlmConfigAction,
  saveNotificationEmailAction,
  saveOAuthConfigAction,
  savePrefsAction,
  signInGithubAction,
  signInGithubRepoAction,
  testLlmConnectionAction,
  testMailAction,
} from '@/app/actions'
import { auth } from '@/auth'
import { isAdminUser } from '@/lib/admin'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { CopyButton } from '@/components/ui/CopyButton'
import { QueryToastGroup } from '@/components/ui/QueryToast'
import { maskClientId, resolveGithubCredentials } from '@/lib/oauth-config'
import { resolveGithubWebhookSecret } from '@/lib/webhook-config'
import { sessionAccessToken, sessionGithubScope, sessionUser } from '@/lib/session'
import { findUserById } from '@/lib/users'
import { enqueueDiscoveryAction, enqueueEnrichAction } from '@/app/(app)/jobs/enqueue'
import { LlmConfigForm } from './llm-form'
import { DeleteAccountForm } from './delete-account-form'
import { MailConfigForm } from './mail-config-form'
import { QuotaForm } from './quota-form'
import { RetentionForm } from './retention-form'
import { NotificationPrefsForm } from './notification-form'
import { PushSubscribe } from './push-subscribe'
import { WebhookSecretForm } from './webhook-secret-form'
import { SubscriptionKindSelect } from './subscription-kind-select'
import { TasteChips } from './taste-chips'

const SUBSCRIPTION_LABELS: Record<string, string> = {
  topic: '主题',
  language: '语言',
  author: '作者',
  release: '更新',
}

export const dynamic = 'force-dynamic'

interface SettingsPageProps {
  searchParams: Promise<{
    oauth?: string
    sub?: string
    llm?: string
    sync?: string
    notify?: string
    webhook?: string
    mail?: string
    site?: string
    admin?: string
    quota?: string
    account?: string
    retention?: string
    pool?: string
    share?: string
    doctor?: string
    test?: string
    code?: string
  }>
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const params = await searchParams
  const session = await auth()
  const sessionInfo = sessionUser(session)
  if (!sessionInfo) redirect('/login')

  const user = await findUserById(Number(sessionInfo.id))
  const admin = await isAdminUser(sessionInfo)
  const token = await sessionAccessToken(session)
  const githubScope = sessionGithubScope(session)
  const actualGithubScopes = token ? await fetchTokenScopes(token).catch(() => null) : null
  const effectiveScope = actualGithubScopes ? actualGithubScopes.join(' ') : githubScope
  const repoScope = effectiveScope === null ? null : hasRepoScope(effectiveScope)
  const deleteScope = effectiveScope === null ? null : hasDeleteRepoScope(effectiveScope)
  let githubTokenState: 'none' | 'ok' | 'invalid' | 'mismatch' | 'unknown' = token ? 'unknown' : 'none'
  if (token) {
    try {
      const owner = await getAuthenticatedLogin(token)
      if (!owner) githubTokenState = 'invalid'
      else if (owner.toLowerCase() !== sessionInfo.login.toLowerCase()) githubTokenState = 'mismatch'
      else githubTokenState = 'ok'
    } catch (error) {
      githubTokenState =
        error instanceof GitHubManageError && error.status === 401 ? 'invalid' : 'unknown'
    }
  }
  const devMode = process.env.AUTH_DEV_MODE === '1' && process.env.NODE_ENV !== 'production'
  const oauth = await resolveGithubCredentials()
  const subscriptions = await loadSubscriptions(getPool(), Number(sessionInfo.id))
  const usage = await loadUsageSummary(getPool(), Number(sessionInfo.id), 30)
  const [pendingDeliveries, pushDevices, mailStatus, siteStatus, quotaConfig, quotaUsage, retentionConfig, retentionLastRun, discovery] =
    await Promise.all([
      countPendingDeliveries(getPool(), Number(sessionInfo.id)),
      countPushSubscriptions(getPool(), Number(sessionInfo.id)),
      loadMailStatus(getPool()),
      resolveBaseUrlStatus(getPool()),
      loadQuotaConfig(getPool()),
      loadQuotaUsage(getPool(), Number(sessionInfo.id)),
      loadRetentionConfig(getPool()),
      loadRetentionLastRun(getPool()),
      loadDiscoveryStatus(getPool()),
    ])
  const webhook = await resolveGithubWebhookSecret()
  const webhookUrl = `${siteStatus.url}/api/github/webhook`
  const notificationEmail = user?.prefs.notificationEmail?.trim() || ''
  const fallbackEmail = user?.email?.trim() || ''
  const webhookUrlIsLocal = webhookUrl
    ? /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(webhookUrl)
    : false
  const envLlm = envLlmSummary()
  const storedStatus = envLlm ? null : await loadStoredLlmStatus(getPool())
  const storedLlm = storedStatus?.summary ?? null
  const currentLlm = envLlm ?? storedLlm
  const currentLlmProvider = currentLlm ? findLlmProvider(currentLlm.providerId) : null
  const llmProviderOptions = LLM_PROVIDERS.map((provider) => ({
    id: provider.id,
    name: provider.name,
    keyUrl: provider.keyUrl,
    defaultModel: provider.defaultModel,
    baseUrl: provider.baseUrl,
    ...(provider.baseUrlOptions ? { baseUrlOptions: provider.baseUrlOptions } : {}),
    models: provider.models,
  }))
  const shareLinks = await listRadarSnapshots(getPool(), Number(sessionInfo.id), 8)
  const topics = Object.entries(user?.profile?.topicWeights ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
  const languages = Object.entries(user?.profile?.languageWeights ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)

  const checklist: Array<{
    id: string
    level: 'ok' | 'warn' | 'error'
    title: string
    detail: string
    href: string
  }> = [
    {
      id: 'github',
      level:
        token && githubTokenState === 'ok' && repoScope === true
          ? 'ok'
          : token && githubTokenState === 'invalid'
            ? 'error'
            : 'warn',
      title: 'GitHub 授权',
      detail:
        token && githubTokenState === 'ok'
          ? repoScope === true
            ? 'token 有效，已具备仓库读写权限。'
            : 'token 有效，但只有基础权限；仓库管理和私有仓库不可用。'
          : token && githubTokenState === 'invalid'
            ? 'token 已失效，需要重新登录。'
            : '还没有可用的 GitHub token。',
      href: '#github-status',
    },
    {
      id: 'profile',
      level: (user?.profile?.starredCount ?? 0) > 0 ? 'ok' : 'warn',
      title: '口味画像',
      detail:
        (user?.profile?.starredCount ?? 0) > 0
          ? `已同步 ${user?.profile?.starredCount} 个 star。`
          : '还没有建立画像；同步 GitHub 后推荐会更准确。',
      href: '#sync',
    },
    {
      id: 'notify-email',
      level: notificationEmail || fallbackEmail ? 'ok' : 'warn',
      title: '通知邮箱',
      detail: notificationEmail || fallbackEmail || '还没有填写通知邮箱。',
      href: '#notifications',
    },
    {
      id: 'push',
      level: pushDevices > 0 ? 'ok' : 'warn',
      title: '浏览器推送',
      detail: pushDevices > 0 ? `已授权 ${pushDevices} 台设备。` : '还没有授权浏览器推送设备。',
      href: '#notifications',
    },
  ]

  if (admin) {
    checklist.push(
      {
        id: 'llm',
        level: currentLlm ? 'ok' : 'error',
        title: 'AI 模型',
        detail: currentLlm
          ? `${currentLlmProvider?.name ?? currentLlm.providerId ?? '自定义'} · ${currentLlm.model}`
          : '还没有配置模型；所有 AI 功能不可用。',
        href: '#ai',
      },
      {
        id: 'pool',
        level: discovery.enrichedRepos > 0 ? 'ok' : 'warn',
        title: '候选池',
        detail: `已收录 ${discovery.totalRepos} 个，已富化 ${discovery.enrichedRepos} 个。`,
        href: '#pool',
      },
      {
        id: 'mail',
        level: mailStatus.summary ? 'ok' : 'warn',
        title: '邮件通道',
        detail: mailStatus.summary ? `已配置（${mailStatus.source === 'env' ? '环境变量' : '页面设置'}）。` : '未配置，邮件通知不会发送。',
        href: '#mail',
      },
      {
        id: 'site',
        level: /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(siteStatus.url) ? 'warn' : 'ok',
        title: '站点地址',
        detail: siteStatus.url,
        href: '#site',
      },
      {
        id: 'webhook',
        level: webhook ? 'ok' : 'warn',
        title: 'GitHub Webhook',
        detail: webhook ? '已配置 Webhook Secret。' : '未配置；动态同步会回退到轮询。',
        href: '#notifications',
      },
    )
  }

  const checklistTodo = checklist.filter((item) => item.level !== 'ok').length
  const doctorChecks = admin && params.doctor === '1' ? await runDoctor(getPool()) : null

  return (
    <div className="page narrow">
      <div className="settings-heading">
        <div>
          <p className="eyebrow">设置</p>
          <h1>偏好与配置</h1>
          <p className="muted small">
            已同步 {user?.profile?.starredCount ?? 0} 个 star
            {user?.profile?.sourceCounts?.owned ? ` · ${user.profile.sourceCounts.owned} 个活跃仓库` : ''}
            {user?.profile?.sourceCounts?.events ? ` · ${user.profile.sourceCounts.events} 个近期事件` : ''}
            {user?.starsSyncedAt ? ` · ${new Date(user.starsSyncedAt).toLocaleString('zh-CN')}` : ''}
          </p>
        </div>
      </div>

      <nav className="settings-toc" aria-label="设置导航">
        <a href="#checklist">配置检查</a>
        {admin ? <a href="#deep-check">深度检查</a> : null}
        <a href="#github-status">GitHub 授权</a>
        {admin ? <a href="#ai">AI 模型</a> : null}
        <a href="#automation">后台自动化</a>
        {admin ? <a href="#pool">候选池</a> : null}
        <a href="#notifications">通知</a>
        {admin ? <a href="#mail">邮件通道</a> : null}
        {admin ? <a href="#site">站点地址</a> : null}
        {admin ? <a href="#quota">限流与配额</a> : null}
        {admin ? <a href="#retention">数据保留</a> : null}
        <a href="#usage">AI 用量</a>
        {topics.length > 0 || languages.length > 0 ? <a href="#taste">口味画像</a> : null}
        <a href="#subscriptions">订阅规则</a>
        {token ? <a href="#sync">同步画像</a> : null}
        <a href="#privacy">隐私与数据</a>
        {admin ? <a href="#oauth">GitHub OAuth</a> : null}
        {devMode ? <a href="#demo">演示数据</a> : null}
      </nav>

      <section className="panel" id="checklist">
        <h2>配置检查</h2>
        <p className="muted small">
          {checklistTodo === 0 ? '当前配置完整，没有需要处理的项。' : `${checklistTodo} 项可以优化；点击条目跳到对应设置。`}
        </p>
        <ul className="settings-checklist">
          {checklist.map((item) => (
            <li key={item.id} className={`settings-check ${item.level}`}>
              <span
                className={
                  item.level === 'ok'
                    ? 'chip verified'
                    : item.level === 'error'
                      ? 'chip release'
                      : 'chip subtle'
                }
              >
                {item.level === 'ok' ? '正常' : item.level === 'error' ? '缺失' : '建议'}
              </span>
              <a href={item.href}>{item.title}</a>
              <span className="muted small">{item.detail}</span>
            </li>
          ))}
        </ul>
      </section>

      {admin ? (
        <section className="panel" id="deep-check">
          <h2>深度检查</h2>
          <p className="muted small">
            检查数据库、迁移、pgvector、候选池、模型、Embedding、GitHub 授权、邮件、站点地址和任务队列。
            会读取 token scope，但不会发送邮件或调用模型。
          </p>
          <div className="feed-actions">
            <Link className="btn small" href="/settings?doctor=1#deep-check">
              {doctorChecks ? '重新运行深度检查' : '运行深度检查'}
            </Link>
          </div>
          {doctorChecks ? (
            <ul className="settings-checklist">
              {doctorChecks.map((check) => (
                <li key={check.id} className={`settings-check ${check.level}`}>
                  <span
                    className={
                      check.level === 'ok'
                        ? 'chip verified'
                        : check.level === 'error'
                          ? 'chip release'
                          : 'chip subtle'
                    }
                  >
                    {check.level === 'ok' ? '正常' : check.level === 'error' ? '错误' : '建议'}
                  </span>
                  <strong>{check.title}</strong>
                  <span className="muted small">{check.detail}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">还没有运行；点击上方按钮生成一份检查结果。</p>
          )}
        </section>
      ) : null}

      <section className="panel" id="github-status">
        <h2>GitHub 授权</h2>
        <ul className="maintain-list">
          <li>登录账户：{sessionInfo.login}</li>
          <li>
            访问令牌：
            {token
              ? githubTokenState === 'ok'
                ? '有效'
                : githubTokenState === 'invalid'
                  ? '已失效，需要重新登录'
                  : githubTokenState === 'mismatch'
                    ? `属于其他账户（${sessionInfo.login} 之外）`
                    : '暂时无法验证（GitHub API 不可用）'
              : '未获取（仅使用环境变量或未通过 GitHub 登录）'}
          </li>
          <li>
            仓库权限：
            {repoScope === true
              ? deleteScope === true
                ? '已授权 repo + delete_repo'
                : '已授权 repo（删除仓库需单独申请 delete_repo）'
              : repoScope === false
                ? '仅基础权限（公开数据只读）'
                : '未知'}
          </li>
        </ul>
        {githubTokenState === 'invalid' || githubTokenState === 'mismatch' ? (
          <div className="webhook-form-actions">
            <p className="muted small">
              {githubTokenState === 'invalid'
                ? 'GitHub 访问令牌已失效，实时搜索、动态同步和仓库管理会暂停。'
                : '当前令牌属于其他 GitHub 账户，仓库管理已停用。'}
            </p>
            <form action={signInGithubAction}>
              <input type="hidden" name="redirectTo" value="/settings" />
              <button className="btn small" type="submit">
                重新登录 GitHub
              </button>
            </form>
          </div>
        ) : null}
        {repoScope === false ? (
          <div className="webhook-form-actions">
            <p className="muted small">
              需要读取私有仓库、同步维护项目或管理仓库时，再申请 <code>repo</code>；删除仓库时才会单独申请 <code>delete_repo</code>。日常雷达只需要基础权限。
            </p>
            <form action={signInGithubRepoAction}>
              <input type="hidden" name="redirectTo" value="/settings" />
              <button className="btn small" type="submit">
                授权仓库管理
              </button>
            </form>
          </div>
        ) : null}
      </section>

      <QueryToastGroup
        toasts={[
          {
            paramKey: 'oauth',
            code: params.oauth,
            messages: {
              saved: 'OAuth 凭据已更新。',
              cleared: 'OAuth 配置已清除。',
              invalid: 'Client ID 或 Client Secret 格式不正确。',
            },
            tones: { saved: 'success', cleared: 'success' },
          },
          {
            paramKey: 'sub',
            code: params.sub,
            messages: { invalid: '订阅值格式不正确，请检查后重试。' },
          },
          {
            paramKey: 'llm',
            code: params.llm,
            messages: {
              saved: '模型配置已保存。',
              cleared: '模型配置已清除。',
              invalid: '模型配置不完整或格式不正确。',
              'key-required': '更换服务商后需要重新填写 API Key。',
              env: '当前使用环境变量配置，页面修改不会生效。',
              missing: '生成周报前需要先在下方配置 AI 模型。',
            },
            tones: { saved: 'success', cleared: 'success' },
          },
          {
            paramKey: 'sync',
            code: params.sync,
            messages: {
              ok: '口味画像已更新。',
              error: '画像同步失败，请检查 GitHub 授权范围或稍后重试。',
            },
            tones: { ok: 'success' },
          },
          {
            paramKey: 'notify',
            code: params.notify,
            messages: {
              saved: '通知偏好已保存。',
              'email-saved': '通知邮箱已保存。',
              'email-invalid': '通知邮箱格式不正确。',
            },
            tones: { saved: 'success', 'email-saved': 'success' },
          },
          {
            paramKey: 'webhook',
            code: params.webhook,
            messages: {
              saved: 'Webhook Secret 已保存。',
              cleared: 'Webhook Secret 已清除。',
              invalid: 'Webhook Secret 需要 8-256 个字符。',
              'key-required': '还没有保存 Secret，请先填写一个。',
              env: '当前使用环境变量 GITHUB_WEBHOOK_SECRET，页面修改不会生效。',
            },
            tones: { saved: 'success', cleared: 'success' },
          },
          {
            paramKey: 'mail',
            code: params.mail,
            messages: {
              saved: '邮件通道已保存。',
              cleared: '邮件通道已清除。',
              invalid: '邮件配置不完整或格式不正确，请检查服务器、端口和邮箱。',
              env: '当前使用环境变量 SMTP_URL，页面修改不会生效。',
            },
            tones: { saved: 'success', cleared: 'success' },
          },
          {
            paramKey: 'site',
            code: params.site,
            messages: {
              saved: '站点地址已保存。',
              invalid: '站点地址需要是 http:// 或 https:// 开头的完整地址。',
              env: '当前使用环境变量 RADAR_BASE_URL，页面修改不会生效。',
            },
            tones: { saved: 'success' },
          },
          {
            paramKey: 'admin',
            code: params.admin,
            messages: { denied: '只有管理员可以修改全局配置。' },
          },
          {
            paramKey: 'quota',
            code: params.quota,
            messages: { saved: '限流配置已保存。', reset: '限流配置已恢复默认。' },
            tones: { saved: 'success', reset: 'success' },
          },
          {
            paramKey: 'account',
            code: params.account,
            messages: {
              confirm: '请输入完整登录名以确认删除账号。',
              'last-admin': '当前是唯一管理员，不能删除自己。请先在 ADMIN_LOGINS 增加另一位管理员。',
              error: '账号删除失败，请稍后重试或联系管理员。',
            },
          },
          {
            paramKey: 'share',
            code: params.share,
            messages: { revoked: '分享链接已撤销。' },
            tones: { revoked: 'success' },
          },
          {
            paramKey: 'retention',
            code: params.retention,
            messages: {
              saved: '数据保留策略已保存。',
              reset: '数据保留策略已恢复默认。',
              ran: '清理已完成。',
              error: '清理失败，请查看 worker/web 日志。',
            },
            tones: { saved: 'success', reset: 'success', ran: 'success' },
          },
          {
            paramKey: 'pool',
            code: params.pool,
            messages: {
              queued: '候选池刷新任务已排队，进度见任务中心。',
              updated: '候选池已更新。',
              enriched: '候选池富化已完成。',
            },
            tones: { queued: 'success', updated: 'success', enriched: 'success' },
          },
        ]}
      />
      {storedStatus?.state === 'unreadable' ? (
        <div className="notice">
          检测到已保存的模型配置，但当前服务无法解密（通常是 AUTH_SECRET 发生变化）。请重新填写一次 API
          Key，之后同步画像不会再清除它。
        </div>
      ) : null}
      {!admin ? (
        <div className="notice">
          当前账号不是管理员。AI 模型、邮件通道、站点地址、GitHub OAuth 和 Webhook 属于全局配置，只有管理员可以修改；通知偏好、通知邮箱和订阅仍可自行设置。
        </div>
      ) : null}
      {admin ? (
      <section className="panel" id="ai">
        <h2>AI 模型</h2>
        <p className="muted small">
          用于生成周报叙事和富化摘要。支持 Anthropic、OpenAI、DeepSeek、Qwen、Gemini、Grok、GLM、Kimi 等 8
          家服务商，共 45 个预置模型，也可以手动填写新模型。
        </p>
        {currentLlm ? (
          <p className="muted">
            当前：{currentLlmProvider?.name ?? currentLlm.providerId} · <code>{currentLlm.model}</code>
            {currentLlm.baseUrl ? ` · ${currentLlm.baseUrl}` : ''}
            {storedLlm?.keyHint ? ` · Key 已保存（末四位 ${storedLlm.keyHint}）` : ''}
            {envLlm ? '（环境变量）' : ''}
          </p>
        ) : (
          <p className="muted">
            {storedStatus?.state === 'unreadable'
              ? '配置行还在，但无法解密，需要重新填写一次 API Key。'
              : '尚未配置。生成周报前需要在这里选择服务商并填入 API Key。'}
          </p>
        )}
        {params.test === 'llm-ok' ? <div className="notice success">模型连接正常。</div> : null}
        {params.test === 'llm-fail' ? (
          <div className="notice">
            模型连接失败{params.code ? `（HTTP ${params.code}）` : ''}。请检查 API Key、模型名、端点和服务商额度。
          </div>
        ) : null}
        {params.test === 'llm-missing' ? <div className="notice">还没有可测试的模型配置。</div> : null}
        {currentLlm ? (
          <form action={testLlmConnectionAction} className="inline-form">
            <button className="btn quiet small" type="submit">
              测试模型连接
            </button>
          </form>
        ) : null}
        {envLlm ? (
          <p className="muted small">通过环境变量 LLM_API_KEY 配置，页面修改不会生效。</p>
        ) : (
          <>
            <form action={saveLlmConfigAction} autoComplete="off">
              <LlmConfigForm
                providers={llmProviderOptions}
                current={
                  storedLlm
                    ? {
                        providerId: storedLlm.providerId,
                        model: storedLlm.model,
                        baseUrl: storedLlm.baseUrl,
                        embeddingModel: storedLlm.embeddingModel,
                      }
                    : null
                }
                hasExistingKey={Boolean(storedLlm)}
                keyHint={storedLlm?.keyHint}
              />
              <div className="form-actions">
                <button className="btn solid" type="submit">
                  保存模型配置
                </button>
              </div>
            </form>
            {storedLlm ? (
              <ConfirmDialog
                action={clearLlmConfigAction}
                triggerLabel="清除模型配置"
                triggerClassName="btn quiet danger"
                title="清除模型配置"
                description="清除后，生成周报叙事和 LLM 富化都会停止工作，已保存的 API Key 会从数据库删除。"
                confirmLabel="确认清除"
              />
            ) : null}
          </>
        )}
      </section>
      ) : null}

      <section className="panel" id="automation">
        <h2>后台自动化</h2>
        <p className="muted small">
          独立 worker 每 15 分钟同步 GitHub 动态和 release，每 30 分钟检查本周精选邮件，并持续投递邮件/浏览器推送。失败任务会进入重试并在收件箱提醒。
        </p>
        <ul className="maintain-list">
          <li>待投递消息：{pendingDeliveries} 条</li>
          <li>邮件通道：{mailStatus.summary ? `已配置（${mailStatus.source === 'env' ? '环境变量' : '页面设置'}）` : '未配置（仅站内通知）'}</li>
          <li>已授权推送设备：{pushDevices} 台</li>
        </ul>
        <p className="muted small">
          本地运行：<code>pnpm worker</code>。生产环境建议让 web 设置 <code>RADAR_INLINE_JOBS=0</code>，只由 worker 执行任务。
        </p>
        {admin ? (
          <div className="feed-actions">
            <Link className="btn quiet small" href="/ops">
              打开运维面板
            </Link>
          </div>
        ) : null}
      </section>

      {admin ? (
      <section className="panel" id="pool">
        <h2>候选池</h2>
        <p className="muted small">
          雷达、趋势和维护建议都基于已富化仓库。worker 每 6 小时尝试自动采集一次；也可以在这里手动刷新。
        </p>
        <ul className="maintain-list">
          <li>已收录仓库：{discovery.totalRepos} 个</li>
          <li>已富化：{discovery.enrichedRepos} 个</li>
          <li>待富化：{discovery.pendingRepos} 个</li>
          <li>
            最近刷新：
            {discovery.lastRun
              ? `${new Date(discovery.lastRun.at).toLocaleString('zh-CN')} · 新增 ${discovery.lastRun.inserted} · 富化 ${discovery.lastRun.enriched}`
              : '尚未运行'}
          </li>
        </ul>
        <form action={enqueueDiscoveryAction} className="webhook-form">
          <label className="field">
            <span>主题（可选，逗号分隔）</span>
            <input name="topics" placeholder="llm, ai-agents, developer-tools" spellCheck={false} />
          </label>
          <p className="muted small">留空使用 RADAR_TOPICS 默认主题。采集会消耗 GitHub Search 限额，富化会消耗模型额度。</p>
          <div className="webhook-form-actions">
            <button className="btn small" type="submit">
              刷新候选池
            </button>
            <Link className="btn quiet small" href="/tasks">
              查看任务
            </Link>
          </div>
        </form>

        <form action={enqueueEnrichAction} className="webhook-form">
          <label className="field">
            <span>只富化待处理仓库（本轮数量）</span>
            <input name="limit" type="number" min={1} max={50} defaultValue={20} />
          </label>
          <p className="muted small">
            不重新采集，只对已收录但还没有摘要的仓库补 README 和模型摘要。适合候选池排队较多时逐步消化。
          </p>
          <div className="webhook-form-actions">
            <button className="btn quiet small" type="submit">
              富化待处理仓库
            </button>
          </div>
        </form>
      </section>
      ) : null}

      <section className="panel" id="notifications">
        <h2>通知</h2>
        <form action={saveNotificationEmailAction} className="webhook-form" autoComplete="off">
          <p className="muted small">
            当前通知邮箱：{notificationEmail || fallbackEmail || '未设置'}
            {!notificationEmail && fallbackEmail ? '（来自 GitHub）' : ''}。
            支持 QQ、163、Gmail 等任意邮箱；留空则继续使用 GitHub 邮箱。
          </p>
          <label className="field">
            <span>通知邮箱</span>
            <input
              name="email"
              type="email"
              defaultValue={notificationEmail}
              placeholder={fallbackEmail || 'you@qq.com'}
              spellCheck={false}
            />
          </label>
          <div className="webhook-form-actions">
            <button className="btn quiet small" type="submit">
              保存通知邮箱
            </button>
          </div>
        </form>
        <NotificationPrefsForm
          initial={
            user?.prefs.notificationPrefs ?? {
              githubStar: true,
              githubFork: true,
              githubIssue: true,
              githubPull: true,
              githubRelease: true,
              emailNotifications: false,
              pushNotifications: false,
              weeklyDigest: false,
            }
          }
        />
        <PushSubscribe />
        {admin ? (
        <div className="webhook-box">
          <h3 className="maintain-subhead">实时 Webhook（可选）</h3>
          <p className="muted small">
            在仓库 Settings → Webhooks 填完整公网 URL，例如 <code>https://你的域名/api/github/webhook</code>（不能只填路径）。
            选择 star、fork、issues、pull_request、release 事件，即可实时接收动态。
          </p>
          {webhook?.source === 'env' ? (
            <p className="muted small">当前用环境变量 GITHUB_WEBHOOK_SECRET 配置，页面修改不会生效。</p>
          ) : (
            <>
              {webhookUrl ? (
                <div>
                  <p className="muted small">
                    当前配置的完整地址：<code>{webhookUrl}</code>
                  </p>
                  {webhookUrlIsLocal ? (
                    <p className="job-error">
                      这是本机地址，GitHub 无法访问。请改成公网域名，或先启动 cloudflared/ngrok 隧道。
                    </p>
                  ) : null}
                </div>
              ) : null}
              <p className="muted small">
                {webhook ? 'Webhook Secret 已加密保存在数据库，GitHub 里填同一个值。' : '还没有配置 Webhook Secret。'}
              </p>
              <WebhookSecretForm hasExisting={Boolean(webhook)} />
              {webhook ? (
                <ConfirmDialog
                  action={clearGithubWebhookSecretAction}
                  triggerLabel="清除 Webhook Secret"
                  triggerClassName="btn quiet danger small"
                  title="清除 Webhook Secret"
                  description="清除后 GitHub Webhook 请求会被拒绝，但收件箱轮询仍可继续使用。"
                  confirmLabel="确认清除"
                />
              ) : null}
            </>
          )}
        </div>
        ) : null}
      </section>

      {admin ? (
      <>
      <section className="panel" id="mail">
        <h2>邮件通道</h2>
        <p className="muted small">
          邮件通知、任务失败提醒和每周精选都通过这里发送。密码会使用 AUTH_SECRET 加密保存在数据库；QQ、163、Gmail 需要填写授权码或应用专用密码。
        </p>
        {params.test === 'mail-ok' ? (
          <div className="notice success">测试邮件已发送，请查收（也检查垃圾箱）。</div>
        ) : null}
        {params.test === 'mail-fail' ? (
          <div className="notice">测试邮件发送失败，请检查 SMTP 服务器、端口、授权码和发件地址。</div>
        ) : null}
        {params.test === 'mail-missing' ? <div className="notice">还没有配置邮件通道。</div> : null}
        {params.test === 'mail-no-address' ? (
          <div className="notice">当前账号还没有通知邮箱，请先在「通知」里填写。</div>
        ) : null}
        <MailConfigForm status={mailStatus} />
        {mailStatus.summary ? (
          <form action={testMailAction} className="inline-form">
            <button className="btn quiet small" type="submit">
              发送测试邮件到我的通知邮箱
            </button>
          </form>
        ) : null}
        {mailStatus.source === 'database' ? (
          <ConfirmDialog
            action={clearMailConfigAction}
            triggerLabel="清除邮件通道"
            triggerClassName="btn quiet danger small"
            title="清除邮件通道"
            description="清除后邮件通知会留在队列并最终失败，站内收件箱和浏览器推送不受影响。"
            confirmLabel="确认清除"
          />
        ) : null}
      </section>

      <section className="panel" id="site">
        <h2>站点地址</h2>
        <p className="muted small">
          用于邮件里的项目链接和 GitHub Webhook 完整地址。填写公网地址后，别人收到的邮件才能点回你的站点。
        </p>
        {siteStatus.source === 'env' ? (
          <p className="muted small">
            当前使用环境变量 <code>RADAR_BASE_URL</code>：<code>{siteStatus.url}</code>，页面修改不会生效。
          </p>
        ) : (
          <form action={saveBaseUrlAction} className="webhook-form">
            <label className="field">
              <span>公开地址</span>
              <input name="siteUrl" defaultValue={siteStatus.url} placeholder="https://radar.example.com" spellCheck={false} />
            </label>
            <div className="webhook-form-actions">
              <button className="btn small" type="submit">
                保存站点地址
              </button>
            </div>
          </form>
        )}
      </section>
      </>
      ) : null}

      {admin ? (
      <section className="panel" id="quota">
        <h2>限流与配额</h2>
        <p className="muted small">
          控制每个用户的 AI 调用、任务和投递频率，以及全站每日 token 预算。公测阶段建议保持默认值或更低。
        </p>
        <QuotaForm config={quotaConfig} usage={quotaUsage} />
        <ConfirmDialog
          action={resetQuotaConfigAction}
          triggerLabel="恢复默认限流"
          triggerClassName="btn quiet danger small"
          title="恢复默认限流"
          description="恢复后使用内置默认值；已产生今天的用量不会被清零。"
          confirmLabel="确认恢复"
        />
      </section>
      ) : null}

      {admin ? (
      <section className="panel" id="retention">
        <h2>数据保留与自动清理</h2>
        <p className="muted small">
          worker 每天最多清理一次过期数据，也可以在这里手动执行。默认只清理运行日志，AI 生成内容和 Copilot 对话默认永久保留。
        </p>
        <RetentionForm config={retentionConfig} lastRun={retentionLastRun} />
        <div className="webhook-form-actions">
          <ConfirmDialog
            action={runRetentionCleanupAction}
            triggerLabel="立即清理过期数据"
            triggerClassName="btn quiet small"
            title="立即清理过期数据"
            description="按当前保留策略删除过期记录，操作不可撤销；AI 生成内容默认不在清理范围内。"
            confirmLabel="确认清理"
          />
          <ConfirmDialog
            action={resetRetentionConfigAction}
            triggerLabel="恢复默认保留策略"
            triggerClassName="btn quiet danger small"
            title="恢复默认保留策略"
            description="恢复默认值不会立即删除数据；下一次清理会按默认策略执行。"
            confirmLabel="确认恢复"
          />
        </div>
      </section>
      ) : null}

      <section className="panel" id="usage">
        <h2>AI 用量（近 30 天）</h2>
        <p className="muted">
          {usage.calls} 次调用 · {usage.promptTokens + usage.completionTokens} tokens
          {usage.models.length > 0 ? ` · ${usage.models.length} 个模型` : ''}
        </p>
        {usage.models.length > 0 ? (
          <ul className="usage-list">
            {usage.models.map((item) => (
              <li key={`${item.providerId}:${item.model}`}>
                <span>
                  {item.providerId ? `${item.providerId} · ` : ''}
                  {item.model}
                </span>
                <span className="muted small">
                  {item.calls} 次 · {item.tokens} tokens
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">还没有记录到模型调用。生成报告或使用搭档后会出现在这里。</p>
        )}
      </section>

      {topics.length > 0 || languages.length > 0 ? (
        <section className="panel" id="taste">
          <h2>口味画像</h2>
          <p className="muted small">
            由最近 star、你维护的仓库和近期公开事件共同生成。点击标签可以排除该方向，再次点击恢复；想主动关注某个主题，可以在下方订阅规则里添加。
          </p>
          <TasteChips
            topics={topics}
            languages={languages}
            initialExcludedTopics={user?.prefs.excludedTopics ?? []}
            initialExcludedLanguages={user?.prefs.excludedLanguages ?? []}
          />
        </section>
      ) : null}

      <section className="panel">
        <details>
          <summary className="advanced-summary">高级：手动编辑排除项</summary>
          <form action={savePrefsAction} className="advanced-form">
            <label className="field">
              <span>不想看到的 topics（逗号分隔）</span>
              <input
                name="excludedTopics"
                defaultValue={user?.prefs.excludedTopics.join(', ') ?? ''}
                placeholder="crypto, web3"
              />
            </label>
            <label className="field">
              <span>不想看到的语言</span>
              <input
                name="excludedLanguages"
                defaultValue={user?.prefs.excludedLanguages.join(', ') ?? ''}
                placeholder="PHP"
              />
            </label>
            <div className="form-actions">
              <button className="btn" type="submit">
                保存并重新计算
              </button>
            </div>
          </form>
        </details>
      </section>

      <section className="panel" id="subscriptions">
        <h2>订阅规则</h2>
        <p className="muted small">
          主题 / 语言 / 作者订阅会提升相关项目在 feed 中的排序；仓库更新订阅会追踪这些仓库的新版本。
        </p>
        {subscriptions.length > 0 ? (
          <ul className="subscription-list">
            {subscriptions.map((sub) => (
              <li key={`${sub.kind}:${sub.value}`}>
                <span className="chip subtle">{SUBSCRIPTION_LABELS[sub.kind] ?? sub.kind}</span>
                <span className="subscription-value">{sub.value}</span>
                <form action={removeSubscriptionAction}>
                  <input type="hidden" name="kind" value={sub.kind} />
                  <input type="hidden" name="value" value={sub.value} />
                  <button className="btn quiet small" type="submit">
                    移除
                  </button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">还没有订阅。</p>
        )}
        <form action={addSubscriptionAction} className="subscription-form">
          <SubscriptionKindSelect />
          <input className="input" name="value" placeholder="ai-agents / TypeScript / vercel / owner/repo" />
          <button className="btn small" type="submit">
            添加订阅
          </button>
        </form>
      </section>

      {token ? (
        <form className="panel" id="sync" action={resyncStarsAction}>
          <h2>同步画像</h2>
          <p className="muted small">重新读取你最近的 star、活跃仓库和公开事件，更新口味画像。</p>
          {user?.profile && !user.profile.sourceCounts?.owned && !user.profile.sourceCounts?.events ? (
            <p className="muted small">当前画像只来自 star，点一次同步会加入最近维护的仓库和公开事件。</p>
          ) : null}
          <div className="form-actions">
            <button className="btn" type="submit">
              重新同步
            </button>
          </div>
        </form>
      ) : null}

      <section className="panel" id="teams">
        <h2>团队工作区</h2>
        <p className="muted small">
          创建团队、邀请成员并分配所有者 / 管理员 / 成员 / 只读角色。团队共享资源会在此基础上逐步接入。
        </p>
        <div className="feed-actions">
          <Link className="btn small" href="/teams">
            打开团队工作区
          </Link>
        </div>
      </section>

      <section className="panel" id="privacy">
        <h2>隐私与数据</h2>
        <p className="muted small">
          你可以随时导出全部个人数据，或永久删除账号。GitHub token、推送订阅密钥等凭据不会出现在导出文件中。
        </p>
        <div className="feed-actions">
          <a className="btn small" href="/api/account/export">
            导出全部数据
          </a>
          <Link className="btn quiet small" href="/privacy">
            隐私说明
          </Link>
          <Link className="btn quiet small" href="/terms">
            服务条款
          </Link>
        </div>
        {shareLinks.length > 0 ? (
          <div className="webhook-box">
            <h3 className="maintain-subhead">分享链接</h3>
            <p className="muted small">分享雷达默认保留 90 天。撤销后链接会立即失效。</p>
            <ul className="share-link-list">
              {shareLinks.map((share) => {
                const expired = Boolean(share.expiresAt && Date.parse(share.expiresAt) <= Date.now())
                const status = share.revokedAt ? '已撤销' : expired ? '已过期' : '有效'
                return (
                  <li className="share-link-row" key={share.token}>
                    <div className="share-link-main">
                      <div className="share-link-title">
                        {!share.revokedAt && !expired ? (
                          <Link href={`/radar/${share.token}`}>{share.login} · {share.mode}</Link>
                        ) : (
                          <span>{share.login} · {share.mode}</span>
                        )}
                        <span className="chip subtle">{status}</span>
                      </div>
                      <span className="share-link-meta">
                        {new Date(share.createdAt).toLocaleDateString('zh-CN')}
                        {share.expiresAt ? ` · ${new Date(share.expiresAt).toLocaleDateString('zh-CN')} 到期` : ''}
                        {share.viewCount > 0 ? ` · ${share.viewCount} 次浏览` : ''}
                      </span>
                    </div>
                    <div className="share-link-actions">
                      {!share.revokedAt && !expired ? (
                        <CopyButton
                          value={`${siteStatus.url.replace(/\/+$/, '')}/radar/${share.token}`}
                          label="复制"
                          className="btn quiet small"
                        />
                      ) : null}
                      {!share.revokedAt ? (
                        <form action={revokeRadarShareAction}>
                          <input type="hidden" name="token" value={share.token} />
                          <button className="btn quiet danger small" type="submit">
                            撤销
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : null}
        <DeleteAccountForm login={sessionInfo.login} />
      </section>

      {admin ? (
      <section className="panel" id="oauth">
        <h2>GitHub OAuth 应用</h2>
        {oauth ? (
          <>
            <p className="muted">
              已配置（{oauth.source === 'env' ? '环境变量 AUTH_GITHUB_ID / AUTH_GITHUB_SECRET' : '数据库'}）
              {oauth.source === 'database' ? (
                <>
                  {' '}
                  · Client ID <code>{maskClientId(oauth.clientId)}</code>
                </>
              ) : null}
            </p>
            {oauth.source === 'database' ? (
              <>
                <form action={saveOAuthConfigAction}>
                  <label className="field">
                    <span>Client ID</span>
                    <input name="clientId" defaultValue={oauth.clientId} autoComplete="off" />
                  </label>
                  <label className="field">
                    <span>Client Secret（留空则保持不变）</span>
                    <input name="clientSecret" type="password" autoComplete="off" placeholder="不修改请留空" />
                  </label>
                  <div className="form-actions">
                    <button className="btn" type="submit">
                      更新凭据
                    </button>
                  </div>
                </form>
                <ConfirmDialog
                  action={clearOAuthConfigAction}
                  triggerLabel="清除 OAuth 配置"
                  triggerClassName="btn quiet danger"
                  title="清除 OAuth 配置"
                  description="清除后 GitHub 登录会立即失效，已登录的会话会保留到过期。"
                  confirmLabel="确认清除"
                />
              </>
            ) : (
              <p className="muted small">通过环境变量配置，修改后重启服务即可生效。</p>
            )}
            <p className="muted small">
              <Link href="/setup">查看配置说明</Link>
            </p>
          </>
        ) : (
          <p className="muted">
            尚未配置。<Link href="/setup">去配置 GitHub 登录</Link>。
          </p>
        )}
      </section>
      ) : null}

      {devMode ? (
        <form className="panel" id="demo" action={loadDemoTasteAction}>
          <h2>演示数据</h2>
          <p className="muted small">本地演示模式：把已收录的高分项目当作你的 star，生成口味画像。</p>
          <div className="form-actions">
            <button className="btn" type="submit">
              载入演示口味
            </button>
          </div>
        </form>
      ) : null}
    </div>
  )
}
