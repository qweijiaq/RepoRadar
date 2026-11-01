'use client'

import { useState } from 'react'
import type { MailConfigStatus } from '@repo-radar/core'
import { UiCheck } from '@/components/ui/Check'
import { UiSelect } from '@/components/ui/Select'
import { saveMailConfigAction } from '@/app/actions'

interface Preset {
  id: string
  label: string
  host: string
  port: number
  secure: boolean
  hint: string
}

const PRESETS: Preset[] = [
  {
    id: 'qq',
    label: 'QQ 邮箱',
    host: 'smtp.qq.com',
    port: 465,
    secure: true,
    hint: 'QQ 邮箱需要在「设置 → 账号 → POP3/IMAP/SMTP 服务」开启 SMTP，并生成授权码；密码处填授权码，不是 QQ 密码。',
  },
  {
    id: '163',
    label: '163 邮箱',
    host: 'smtp.163.com',
    port: 465,
    secure: true,
    hint: '163 邮箱需要在「设置 → POP3/SMTP/IMAP」开启 SMTP 服务，并使用客户端授权码作为密码。',
  },
  {
    id: 'gmail',
    label: 'Gmail',
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    hint: 'Gmail 需要开启两步验证并创建「应用专用密码」，不能直接使用 Google 账号密码。',
  },
  {
    id: 'custom',
    label: '自定义 SMTP',
    host: '',
    port: 587,
    secure: false,
    hint: '常见端口：465（SSL）、587（STARTTLS）、25（通常被云厂商封禁）。',
  },
]

function presetFor(summary: MailConfigStatus['summary']): Preset {
  const matched = PRESETS.find((preset) => preset.id !== 'custom' && preset.host === summary?.host)
  return matched ?? PRESETS[3]!
}

export function MailConfigForm({ status }: { status: MailConfigStatus }) {
  const summary = status.summary
  const initialPreset = presetFor(summary)
  const [presetId, setPresetId] = useState(initialPreset.id)
  const [host, setHost] = useState(summary?.host ?? initialPreset.host)
  const [port, setPort] = useState(String(summary?.port ?? initialPreset.port))
  const [secure, setSecure] = useState(summary?.secure ?? initialPreset.secure)
  const [user, setUser] = useState(summary?.user ?? '')
  const [from, setFrom] = useState(summary?.from === 'RepoRadar <radar@localhost>' ? '' : (summary?.from ?? ''))

  const preset = PRESETS.find((item) => item.id === presetId) ?? PRESETS[3]!

  function choosePreset(id: string) {
    setPresetId(id)
    const next = PRESETS.find((item) => item.id === id)
    if (!next || id === 'custom') return
    setHost(next.host)
    setPort(String(next.port))
    setSecure(next.secure)
    if (user && (!from || from === user)) setFrom(user)
  }

  if (status.source === 'env') {
    return (
      <div className="webhook-box">
        <p className="muted small">
          当前使用环境变量 <code>SMTP_URL</code> 配置邮件通道，页面修改不会生效。
          {summary
            ? ` 当前服务器：${summary.host}:${summary.port}${summary.secure ? '（SSL）' : ''}，发件人 ${summary.from}。`
            : ' 但环境变量格式无法解析，请检查是否为 smtp:// 或 smtps:// 开头的完整地址。'}
        </p>
      </div>
    )
  }

  return (
    <form action={saveMailConfigAction} className="webhook-form" autoComplete="off">
      {summary ? (
        <p className="muted small">
          当前：{summary.host}:{summary.port}
          {summary.secure ? ' · SSL' : ' · STARTTLS'}
          {summary.user ? ` · ${summary.user}` : ''} · 发件人 {summary.from}
          {summary.hasPassword ? ' · 密码已加密保存' : ''}
        </p>
      ) : status.unreadable ? (
        <p className="job-error">已保存的邮件配置无法解密（通常是 AUTH_SECRET 变化），请重新填写密码。</p>
      ) : (
        <p className="muted small">还没有配置邮件通道。填写后，邮件通知和每周精选会由 worker 投递。</p>
      )}

      <div className="field">
        <span>邮箱服务商</span>
        <UiSelect
          value={presetId}
          onChange={choosePreset}
          options={PRESETS.map((item) => ({ value: item.id, label: item.label }))}
          ariaLabel="邮箱服务商"
        />
      </div>

      <label className="field">
        <span>SMTP 服务器</span>
        <input
          name="host"
          value={host}
          onChange={(event) => setHost(event.target.value)}
          placeholder="smtp.qq.com"
          spellCheck={false}
          required
        />
      </label>

      <label className="field">
        <span>端口</span>
        <input
          name="port"
          value={port}
          onChange={(event) => setPort(event.target.value)}
          inputMode="numeric"
          placeholder="465"
          required
        />
      </label>

      <UiCheck
        name="secure"
        checked={secure}
        onChange={setSecure}
        label="SSL / TLS"
        hint="465 端口通常开启；587 端口一般关闭并使用 STARTTLS"
      />

      <label className="field">
        <span>SMTP 用户名</span>
        <input
          name="user"
          type="email"
          value={user}
          onChange={(event) => {
            const next = event.target.value
            setUser(next)
            if (!from || from === user) setFrom(next)
          }}
          placeholder="you@qq.com"
          autoComplete="username"
          spellCheck={false}
        />
      </label>

      <label className="field">
        <span>密码 / 授权码</span>
        <input
          name="pass"
          type="password"
          placeholder={summary?.hasPassword ? '已保存，留空保持不变' : 'QQ / 163 请填授权码'}
          autoComplete="new-password"
          spellCheck={false}
        />
      </label>

      <label className="field">
        <span>发件人</span>
        <input
          name="from"
          value={from}
          onChange={(event) => setFrom(event.target.value)}
          placeholder={user || 'you@qq.com'}
          spellCheck={false}
        />
      </label>

      <p className="muted small">{preset.hint} 发件人通常要和服务商账号一致。</p>
      <div className="webhook-form-actions">
        <button className="btn small" type="submit">
          保存邮件通道
        </button>
      </div>
    </form>
  )
}
