'use client'

import { useActionState, useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import type { ManagedRepo } from '@repo-radar/core'
import { UiSelect } from '@/components/ui/Select'
import { createReposAction, deleteReposAction, updateReposAction } from './actions'
import { initialRepoActionState, type RepoActionResult } from './types'

type Dialog =
  | { kind: 'create' }
  | { kind: 'batch' }
  | { kind: 'delete' }
  | { kind: 'edit'; repo: ManagedRepo }
  | null

function UiCheck({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: ReactNode
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      className={checked ? 'ui-check checked' : 'ui-check'}
      onClick={() => onChange(!checked)}
    >
      <span className="ui-check-box" aria-hidden="true">
        {checked ? '✓' : ''}
      </span>
      <span>{label}</span>
    </button>
  )
}

function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  const titleId = useId()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  if (!mounted) return null

  return createPortal(
    <div
      className="ui-dialog-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className={wide ? 'ui-dialog wide' : 'ui-dialog'} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="repo-dialog-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="repo-dialog-close" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}

function Result({ state }: { state: RepoActionResult }) {
  if (state.status === 'idle') return null
  return (
    <div className={state.status === 'success' ? 'notice success' : 'notice'}>
      <strong>{state.message}</strong>
      {state.details.length > 0 ? (
        <ul className="repo-result-list">
          {state.details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

const CREATE_IGNORE_OPTIONS = [
  { value: '', label: '不生成' },
  { value: 'Node', label: 'Node' },
  { value: 'Python', label: 'Python' },
  { value: 'Go', label: 'Go' },
  { value: 'Rust', label: 'Rust' },
  { value: 'Java', label: 'Java' },
  { value: 'macOS', label: 'macOS' },
]

const CREATE_LICENSE_OPTIONS = [
  { value: '', label: '不使用' },
  { value: 'mit', label: 'MIT' },
  { value: 'apache-2.0', label: 'Apache-2.0' },
  { value: 'gpl-3.0', label: 'GPL-3.0' },
  { value: 'bsd-3-clause', label: 'BSD-3-Clause' },
]

function CreateDialog({ onClose }: { onClose: () => void }) {
  const [state, action, pending] = useActionState(createReposAction, initialRepoActionState)
  const [visibility, setVisibility] = useState('public')
  const [autoInit, setAutoInit] = useState(true)
  const [gitignore, setGitignore] = useState('')
  const [license, setLicense] = useState('')

  return (
    <Modal title="新建仓库" onClose={onClose} wide>
      <form action={action} className="repo-form">
        <label className="field">
          <span>仓库名（每行一个，最多 10 个）</span>
          <textarea name="names" rows={3} placeholder={'my-service\nmy-playground'} required />
        </label>
        <label className="field">
          <span>描述（可选，所有新仓库共用）</span>
          <input name="description" maxLength={350} placeholder="一句话说明这个仓库做什么" />
        </label>
        <div className="repo-form-grid">
          <div className="field">
            <span>可见性</span>
            <UiSelect
              name="visibility"
              value={visibility}
              onChange={setVisibility}
              options={[
                { value: 'public', label: '公开' },
                { value: 'private', label: '私有' },
              ]}
              ariaLabel="仓库可见性"
            />
          </div>
          <div className="field">
            <span>.gitignore 模板</span>
            <UiSelect
              name="gitignoreTemplate"
              value={gitignore}
              onChange={setGitignore}
              options={CREATE_IGNORE_OPTIONS}
              ariaLabel="gitignore 模板"
            />
          </div>
          <div className="field">
            <span>许可证</span>
            <UiSelect
              name="licenseTemplate"
              value={license}
              onChange={setLicense}
              options={CREATE_LICENSE_OPTIONS}
              ariaLabel="许可证"
            />
          </div>
        </div>
        <input type="hidden" name="autoInit" value={autoInit ? '1' : '0'} />
        <UiCheck checked={autoInit} onChange={setAutoInit} label="自动生成 README 并初始化仓库" />
        <Result state={state} />
        <div className="ui-dialog-actions">
          <button type="button" className="btn quiet" onClick={onClose}>
            关闭
          </button>
          <button className="btn solid" type="submit" disabled={pending}>
            {pending ? '创建中…' : '批量创建'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function EditDialog({ repo, onClose }: { repo: ManagedRepo; onClose: () => void }) {
  const [state, action, pending] = useActionState(updateReposAction, initialRepoActionState)
  const [name, setName] = useState(repo.name)
  const [description, setDescription] = useState(repo.description ?? '')
  const [visibility, setVisibility] = useState(repo.private ? 'private' : 'public')
  const [archived, setArchived] = useState(repo.archived ? 'archive' : 'unarchive')

  return (
    <Modal title={`编辑 ${repo.fullName}`} onClose={onClose} wide>
      <form action={action} className="repo-form">
        <input type="hidden" name="mode" value="single" />
        <input type="hidden" name="repo" value={repo.fullName} />
        <div className="repo-form-grid">
          <label className="field">
            <span>仓库名</span>
            <input
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="off"
            />
          </label>
          <div className="field">
            <span>可见性</span>
            <UiSelect
              name="visibility"
              value={visibility}
              onChange={setVisibility}
              options={[
                { value: 'public', label: '公开' },
                { value: 'private', label: '私有' },
              ]}
              ariaLabel="仓库可见性"
            />
          </div>
          <div className="field">
            <span>归档状态</span>
            <UiSelect
              name="archived"
              value={archived}
              onChange={setArchived}
              options={[
                { value: 'unarchive', label: '使用中' },
                { value: 'archive', label: '已归档' },
              ]}
              ariaLabel="归档状态"
            />
          </div>
        </div>
        <label className="field">
          <span>描述</span>
          <textarea
            name="description"
            rows={3}
            maxLength={350}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <Result state={state} />
        <div className="ui-dialog-actions">
          <button type="button" className="btn quiet" onClick={onClose}>
            关闭
          </button>
          <button className="btn solid" type="submit" disabled={pending}>
            {pending ? '保存中…' : '保存修改'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function BatchEditDialog({ repos, onClose }: { repos: string[]; onClose: () => void }) {
  const [state, action, pending] = useActionState(updateReposAction, initialRepoActionState)
  const [description, setDescription] = useState('')
  const [clearDescription, setClearDescription] = useState(false)
  const [visibility, setVisibility] = useState('keep')
  const [archived, setArchived] = useState('keep')

  return (
    <Modal title={`批量修改 ${repos.length} 个仓库`} onClose={onClose} wide>
      <form action={action} className="repo-form">
        <input type="hidden" name="mode" value="batch" />
        {repos.map((repo) => (
          <input key={repo} type="hidden" name="repos" value={repo} />
        ))}
        <label className="field">
          <span>描述（留空保持不变）</span>
          <input
            name="description"
            maxLength={350}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="统一更新描述"
          />
        </label>
        <input type="hidden" name="clearDescription" value={clearDescription ? '1' : '0'} />
        <UiCheck checked={clearDescription} onChange={setClearDescription} label="清空这些仓库的描述" />
        <div className="repo-form-grid">
          <div className="field">
            <span>可见性</span>
            <UiSelect
              name="visibility"
              value={visibility}
              onChange={setVisibility}
              options={[
                { value: 'keep', label: '保持不变' },
                { value: 'public', label: '改为公开' },
                { value: 'private', label: '改为私有' },
              ]}
              ariaLabel="批量可见性"
            />
          </div>
          <div className="field">
            <span>归档状态</span>
            <UiSelect
              name="archived"
              value={archived}
              onChange={setArchived}
              options={[
                { value: 'keep', label: '保持不变' },
                { value: 'archive', label: '归档' },
                { value: 'unarchive', label: '取消归档' },
              ]}
              ariaLabel="批量归档状态"
            />
          </div>
        </div>
        <p className="muted small">将作用于：{repos.join('、')}</p>
        <Result state={state} />
        <div className="ui-dialog-actions">
          <button type="button" className="btn quiet" onClick={onClose}>
            关闭
          </button>
          <button className="btn solid" type="submit" disabled={pending}>
            {pending ? '修改中…' : '应用修改'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function DeleteDialog({ repos, onClose }: { repos: string[]; onClose: () => void }) {
  const [state, action, pending] = useActionState(deleteReposAction, initialRepoActionState)
  const [confirmed, setConfirmed] = useState(false)

  return (
    <Modal title={`删除 ${repos.length} 个仓库`} onClose={onClose}>
      <form action={action} className="repo-form">
        {repos.map((repo) => (
          <input key={repo} type="hidden" name="repos" value={repo} />
        ))}
        <p className="muted">
          即将从 GitHub 永久删除以下仓库，此操作不可恢复：
        </p>
        <ul className="repo-delete-list">
          {repos.map((repo) => (
            <li key={repo}>{repo}</li>
          ))}
        </ul>
        <input type="hidden" name="confirm" value={confirmed ? 'yes' : 'no'} />
        <UiCheck checked={confirmed} onChange={setConfirmed} label="我确认删除这些仓库，且不可恢复" />
        <Result state={state} />
        <div className="ui-dialog-actions">
          <button type="button" className="btn quiet" onClick={onClose}>
            取消
          </button>
          <button className="btn danger" type="submit" disabled={!confirmed || pending}>
            {pending ? '删除中…' : '确认删除'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('zh-CN')
}

export function RepoManager({ initialRepos }: { initialRepos: ManagedRepo[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [dialog, setDialog] = useState<Dialog>(null)

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return initialRepos
    return initialRepos.filter(
      (repo) =>
        repo.fullName.toLowerCase().includes(needle) ||
        (repo.description ?? '').toLowerCase().includes(needle),
    )
  }, [initialRepos, query])

  useEffect(() => {
    const names = new Set(initialRepos.map((repo) => repo.fullName))
    setSelected((previous) => {
      const next = new Set([...previous].filter((name) => names.has(name)))
      return next.size === previous.size ? previous : next
    })
  }, [initialRepos])

  const allVisibleSelected = filtered.length > 0 && filtered.every((repo) => selected.has(repo.fullName))
  const selectedRepos = [...selected]

  function toggle(repo: string) {
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(repo)) next.delete(repo)
      else next.add(repo)
      return next
    })
  }

  function toggleAll() {
    setSelected((previous) => {
      const next = new Set(previous)
      if (allVisibleSelected) {
        for (const repo of filtered) next.delete(repo.fullName)
      } else {
        for (const repo of filtered) next.add(repo.fullName)
      }
      return next
    })
  }

  return (
    <>
      <div className="repo-toolbar">
        <div className="repo-toolbar-main">
          <input
            className="input repo-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索仓库名或描述"
            aria-label="搜索仓库"
          />
          <span className="muted small">
            {filtered.length} / {initialRepos.length} 个仓库
          </span>
        </div>
        <div className="repo-toolbar-actions">
          <button type="button" className="btn small solid" onClick={() => setDialog({ kind: 'create' })}>
            新建仓库
          </button>
          <button
            type="button"
            className="btn quiet small"
            disabled={selectedRepos.length === 0}
            onClick={() => setDialog({ kind: 'batch' })}
          >
            批量修改
          </button>
          <button
            type="button"
            className="btn quiet danger small"
            disabled={selectedRepos.length === 0}
            onClick={() => setDialog({ kind: 'delete' })}
          >
            批量删除
          </button>
        </div>
      </div>

      <div className="repo-selectbar">
        <UiCheck checked={allVisibleSelected} onChange={toggleAll} label={`全选当前 ${filtered.length} 个`} />
        <span className="muted small">{selectedRepos.length > 0 ? `已选 ${selectedRepos.length} 个` : '未选择'}</span>
      </div>

      {filtered.length === 0 ? (
        <div className="empty">
          <p>{initialRepos.length === 0 ? '你还没有 GitHub 仓库。' : '没有匹配的仓库。'}</p>
          <p className="small">{initialRepos.length === 0 ? '点击右上角「新建仓库」开始。' : '换个关键词试试。'}</p>
        </div>
      ) : (
        <ul className="repo-manage-list">
          {filtered.map((repo) => {
            const checked = selected.has(repo.fullName)
            return (
              <li className={checked ? 'repo-manage-row selected' : 'repo-manage-row'} key={repo.fullName}>
                <UiCheck
                  checked={checked}
                  onChange={() => toggle(repo.fullName)}
                  label={<span className="sr-only">选择 {repo.fullName}</span>}
                />
                <div className="repo-manage-main">
                  <div className="repo-manage-head">
                    <a className="repo-name" href={repo.htmlUrl} target="_blank" rel="noreferrer">
                      {repo.fullName}
                    </a>
                    <span className="chip subtle">{repo.private ? '私有' : '公开'}</span>
                    {repo.archived ? <span className="chip">已归档</span> : null}
                    {repo.fork ? <span className="chip subtle">Fork</span> : null}
                    {repo.stars > 0 ? <span className="repo-stars">★ {repo.stars}</span> : null}
                  </div>
                  <p className="muted small">{repo.description || '暂无描述'}</p>
                  <span className="repo-meta">
                    更新于 {formatDate(repo.updatedAt ?? repo.pushedAt)} · 默认分支 {repo.defaultBranch}
                  </span>
                </div>
                <div className="repo-row-actions">
                  <Link className="btn quiet small" href={`/repos/${repo.fullName}/optimize`}>
                    曝光优化
                  </Link>
                  <button
                    type="button"
                    className="btn quiet small"
                    onClick={() => setDialog({ kind: 'edit', repo })}
                  >
                    编辑
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {dialog?.kind === 'create' ? <CreateDialog onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === 'batch' ? <BatchEditDialog repos={selectedRepos} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === 'delete' ? <DeleteDialog repos={selectedRepos} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === 'edit' ? (
        <EditDialog repo={dialog.repo} onClose={() => setDialog(null)} />
      ) : null}
    </>
  )
}
