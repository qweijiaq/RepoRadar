import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  TEAM_ROLE_LABEL,
  canAdminTeam,
  canManageTeam,
  canWriteTeam,
  findTeamForUser,
  listTeamMembers,
  listTeamProjectShares,
  listTeamsForUser,
  getPool,
} from '@repo-radar/core'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { FormSelect } from '@/components/ui/FormSelect'
import { QueryToastGroup } from '@/components/ui/QueryToast'
import { auth } from '@/auth'
import { sessionUser } from '@/lib/session'
import {
  addTeamMemberAction,
  createTeamAction,
  deleteTeamAction,
  removeTeamMemberAction,
  setTeamDigestAction,
  shareTeamProjectAction,
  unshareTeamProjectAction,
  updateTeamMemberRoleAction,
} from './actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: '团队工作区 — RepoRadar' }

interface TeamsPageProps {
  searchParams: Promise<{
    team?: string
    error?: string
    saved?: string
  }>
}

const ASSIGNABLE_ROLES = ['admin', 'member', 'viewer'] as const
const ROLE_OPTIONS = ASSIGNABLE_ROLES.map((role) => ({
  value: role,
  label: TEAM_ROLE_LABEL[role],
}))

export default async function TeamsPage({ searchParams }: TeamsPageProps) {
  const params = await searchParams
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) redirect('/login')

  const pool = getPool()
  const userId = Number(currentUser.id)
  const teams = await listTeamsForUser(pool, userId)
  const requestedId = Number(params.team)
  const selected =
    teams.find((team) => team.id === requestedId) ?? teams[0] ?? null
  const detailed = selected ? await findTeamForUser(pool, userId, selected.id) : null
  const members = detailed ? await listTeamMembers(pool, detailed.id) : []
  const sharedProjects = detailed ? await listTeamProjectShares(pool, detailed.id) : []
  const canManage = detailed ? canManageTeam(detailed.role) : false
  const canWrite = detailed ? canWriteTeam(detailed.role) : false
  const isOwner = detailed ? canAdminTeam(detailed.role) : false

  return (
    <div className="page narrow">
      <p className="breadcrumb">
        <Link href="/settings">← 返回设置</Link>
      </p>

      <section className="feed-head">
        <div>
          <p className="eyebrow">团队工作区</p>
          <h1>把雷达和报告共享给团队</h1>
          <p className="feed-meta">
            团队用于共享收藏集、维护报告和后续的技术雷达。当前先提供成员和角色基础：
            所有者、管理员、成员、只读。
          </p>
        </div>
      </section>

      <QueryToastGroup
        toasts={[
          {
            paramKey: 'error',
            code: params.error,
            messages: {
              name: '团队名称至少需要 2 个字符。',
              team: '团队不存在或你没有访问权限。',
              forbidden: '当前角色不能执行这个操作。',
              login: '请填写要邀请的 GitHub 登录名。',
              role: '角色无效。',
              'not-found': '这个 GitHub 用户还没有登录过 RepoRadar，无法直接加入。',
              exists: '这个用户已经在团队里了。',
              owner: '所有者不能被移除或降级。',
              self: '不能在这里移除自己。',
              delete: '删除团队失败，请稍后重试。',
              project: '项目格式应为 owner/name。',
            },
          },
          {
            paramKey: 'saved',
            code: params.saved,
            messages: {
              created: '团队已创建，你是所有者。',
              member: '成员已添加。',
              role: '角色已更新。',
              removed: '成员已移除。',
              deleted: '团队已删除。',
              project: '项目已共享给团队。',
              unshared: '项目已从团队移除。',
              digest: '团队周报邮件设置已保存。',
            },
            tones: {
              digest: 'success',
              created: 'success',
              member: 'success',
              role: 'success',
              removed: 'success',
              deleted: 'success',
              project: 'success',
              unshared: 'success',
            },
          },
        ]}
      />

      <section className="panel">
        <h2>新建团队</h2>
        <form action={createTeamAction} className="webhook-form">
          <label className="field">
            <span>团队名称</span>
            <input name="name" maxLength={80} placeholder="例如：平台工程组" required />
          </label>
          <div className="webhook-form-actions">
            <button className="btn solid small" type="submit">
              创建团队
            </button>
          </div>
        </form>
      </section>

      {teams.length === 0 ? (
        <div className="empty">
          <p>还没有团队。</p>
          <p className="small">创建团队后，可以邀请已经登录过 RepoRadar 的 GitHub 用户。</p>
        </div>
      ) : (
        <div className="teams-layout">
          <aside className="teams-sidebar">
            <p className="eyebrow">我的团队</p>
            <ul className="teams-list">
              {teams.map((team) => (
                <li key={team.id}>
                  <Link
                    className={selected?.id === team.id ? 'team-link active' : 'team-link'}
                    href={`/teams?team=${team.id}`}
                  >
                    <span>{team.name}</span>
                    <small>
                      {TEAM_ROLE_LABEL[team.role]} · {team.memberCount} 人
                    </small>
                  </Link>
                </li>
              ))}
            </ul>
          </aside>

          {detailed ? (
            <section className="panel teams-detail">
              <header className="teams-detail-head">
                <div>
                  <h2>{detailed.name}</h2>
                  <p className="muted small">
                    你的角色：{TEAM_ROLE_LABEL[detailed.role]} · {detailed.memberCount} 位成员 · 周报邮件
                    {detailed.digestEnabled ? '已开启' : '已关闭'}
                  </p>
                </div>
                <div className="feed-actions">
                  <Link className="btn quiet small" href={`/teams/${detailed.id}/maintain`}>
                    维护汇总
                  </Link>
                  {canManage ? (
                    <form action={setTeamDigestAction}>
                      <input type="hidden" name="teamId" value={detailed.id} />
                      <input type="hidden" name="enabled" value={detailed.digestEnabled ? '0' : '1'} />
                      <button className="btn quiet small" type="submit">
                        {detailed.digestEnabled ? '关闭周报邮件' : '开启周报邮件'}
                      </button>
                    </form>
                  ) : null}
                  {isOwner ? (
                    <ConfirmDialog
                      action={deleteTeamAction}
                      fields={{ teamId: String(detailed.id) }}
                      triggerLabel="删除团队"
                      triggerClassName="btn quiet danger small"
                      title={`删除 ${detailed.name}`}
                      description="团队和成员关系会被删除，后续共享资源也会一并失效。此操作不可撤销。"
                      confirmLabel="确认删除"
                    />
                  ) : null}
                </div>
              </header>

              <h3 className="maintain-subhead">成员</h3>
              <ul className="team-member-list">
                {members.map((member) => (
                  <li className="team-member-row" key={member.userId}>
                    <div className="team-member-main">
                      <strong>{member.login}</strong>
                      {member.displayName ? <span className="muted small">{member.displayName}</span> : null}
                      <span className="chip subtle">{TEAM_ROLE_LABEL[member.role]}</span>
                    </div>
                    {canManage && member.role !== 'owner' ? (
                      <div className="team-member-actions">
                        <form action={updateTeamMemberRoleAction} className="inline-form">
                          <input type="hidden" name="teamId" value={detailed.id} />
                          <input type="hidden" name="userId" value={member.userId} />
                          <FormSelect
                            name="role"
                            defaultValue={member.role}
                            options={ROLE_OPTIONS}
                            ariaLabel={`${member.login} 的角色`}
                          />
                          <button className="btn quiet small" type="submit">
                            保存
                          </button>
                        </form>
                        {member.userId !== userId ? (
                          <form action={removeTeamMemberAction}>
                            <input type="hidden" name="teamId" value={detailed.id} />
                            <input type="hidden" name="userId" value={member.userId} />
                            <button className="btn quiet danger small" type="submit">
                              移除
                            </button>
                          </form>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>

              <div className="webhook-box">
                <h3 className="maintain-subhead">共享维护项目</h3>
                <p className="muted small">
                  团队成员可以把项目共享到团队视图；这里展示团队里最近一次维护周报对该项目的摘要。
                </p>
                {sharedProjects.length === 0 ? (
                  <p className="muted small">还没有共享项目。</p>
                ) : (
                  <ul className="team-project-list">
                    {sharedProjects.map((project) => (
                      <li className="team-project-row" key={project.projectFullName}>
                        <div className="team-project-main">
                          <Link href={`/r/${project.projectFullName}`}>{project.projectFullName}</Link>
                          <span className="muted small">由 {project.sharedBy} 共享</span>
                          {project.report ? (
                            <span className="muted small">
                              健康 {project.report.healthScore} · 依赖风险 {project.report.riskCount} · 待办{' '}
                              {project.report.itemCount} · {project.report.reporter} 生成于{' '}
                              {new Date(project.report.generatedAt).toLocaleDateString('zh-CN')}
                            </span>
                          ) : (
                            <span className="muted small">团队还没有生成过这个项目的维护周报</span>
                          )}
                        </div>
                        {canWrite ? (
                          <form action={unshareTeamProjectAction}>
                            <input type="hidden" name="teamId" value={detailed.id} />
                            <input type="hidden" name="project" value={project.projectFullName} />
                            <button className="btn quiet danger small" type="submit">
                              移除
                            </button>
                          </form>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
                {canWrite ? (
                  <form action={shareTeamProjectAction} className="team-add-form">
                    <input type="hidden" name="teamId" value={detailed.id} />
                    <label className="field">
                      <span>共享项目</span>
                      <input className="input" name="project" placeholder="owner/repo" autoComplete="off" required />
                    </label>
                    <button className="btn small" type="submit">
                      共享给团队
                    </button>
                  </form>
                ) : null}
              </div>

              {canManage ? (
                <div className="webhook-box">
                  <h3 className="maintain-subhead">邀请成员</h3>
                  <form action={addTeamMemberAction} className="team-add-form">
                    <input type="hidden" name="teamId" value={detailed.id} />
                    <label className="field">
                      <span>GitHub 登录名</span>
                      <input className="input" name="login" placeholder="octocat" autoComplete="off" required />
                    </label>
                    <label className="field">
                      <span>角色</span>
                      <FormSelect
                        name="role"
                        defaultValue="member"
                        options={ROLE_OPTIONS}
                        ariaLabel="新成员角色"
                      />
                    </label>
                    <button className="btn solid small" type="submit">
                      添加成员
                    </button>
                  </form>
                  <p className="muted small">
                    只能邀请已经登录过 RepoRadar 的用户。管理员可以管理成员；成员可读写共享资源；只读只能查看。
                  </p>
                </div>
              ) : (
                <p className="muted small">当前角色只能查看团队，不能管理成员。</p>
              )}
            </section>
          ) : null}
        </div>
      )}
    </div>
  )
}
