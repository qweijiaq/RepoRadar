'use client'

import { useState } from 'react'
import { deleteAccountAction } from '@/app/actions'

export function DeleteAccountForm({ login }: { login: string }) {
  const [confirmation, setConfirmation] = useState('')
  const matches = confirmation.trim().toLowerCase() === login.toLowerCase()

  return (
    <form action={deleteAccountAction} className="webhook-form">
      <p className="muted small">
        删除后会立即退出登录，并永久移除你的画像、star、订阅、项目、报告、通知、任务、Copilot 对话、补丁和推送订阅。
        该操作不可撤销；如需保留记录，请先导出数据。
      </p>
      <label className="field">
        <span>输入 GitHub 登录名 <code>{login}</code> 以确认</span>
        <input
          name="confirm"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          placeholder={login}
        />
      </label>
      <div className="webhook-form-actions">
        <button className="btn quiet danger small" type="submit" disabled={!matches}>
          永久删除账号
        </button>
      </div>
    </form>
  )
}
