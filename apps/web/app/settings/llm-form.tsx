'use client'

import { useState } from 'react'
import { UiCombobox } from '@/components/ui/Combobox'
import { UiSelect } from '@/components/ui/Select'

export interface LlmProviderOption {
  id: string
  name: string
  keyUrl: string
  defaultModel: string
  baseUrl: string
  baseUrlOptions?: Array<{ label: string; url: string }>
  models: Array<{ id: string; label: string }>
}

interface LlmConfigFormProps {
  providers: LlmProviderOption[]
  current: { providerId: string; model: string; baseUrl: string; embeddingModel?: string } | null
  hasExistingKey: boolean
  keyHint?: string
}

export function LlmConfigForm({ providers, current, hasExistingKey, keyHint }: LlmConfigFormProps) {
  const initialProvider = providers.find((provider) => provider.id === current?.providerId) ?? providers[0]
  const [providerId, setProviderId] = useState(initialProvider?.id ?? '')
  const [model, setModel] = useState(current?.model ?? initialProvider?.defaultModel ?? '')
  const [baseUrl, setBaseUrl] = useState(current?.baseUrl ?? initialProvider?.baseUrl ?? '')
  const [embeddingModel, setEmbeddingModel] = useState(current?.embeddingModel ?? '')

  const provider = providers.find((option) => option.id === providerId) ?? initialProvider
  if (!provider) return null

  const providerChanged = Boolean(current && current.providerId !== providerId)
  const needsKey = !hasExistingKey || providerChanged

  const providerOptions = providers.map((option) => ({
    value: option.id,
    label: option.name,
    meta: `${option.models.length} 个模型`,
  }))
  const modelOptions = provider.models.map((option) => ({ value: option.id, label: option.label }))
  const baseUrlOptions = [
    { value: provider.baseUrl, label: '默认端点' },
    ...(provider.baseUrlOptions ?? []).map((option) => ({ value: option.url, label: option.label })),
  ]

  function changeProvider(id: string) {
    setProviderId(id)
    const next = providers.find((option) => option.id === id)
    if (next) {
      setModel(next.defaultModel)
      setBaseUrl(next.baseUrl)
    }
  }

  return (
    <div className="llm-form">
      <div className="field">
        <span>模型服务商</span>
        <UiSelect
          name="providerId"
          value={providerId}
          onChange={changeProvider}
          options={providerOptions}
          ariaLabel="模型服务商"
        />
      </div>

      <div className="field">
        <span>模型</span>
        <UiCombobox name="model" value={model} onChange={setModel} options={modelOptions} ariaLabel="模型" />
      </div>

      <div className="field wide">
        <span>Base URL（可选）</span>
        <UiCombobox
          name="baseUrl"
          value={baseUrl}
          onChange={setBaseUrl}
          options={baseUrlOptions}
          ariaLabel="Base URL"
        />
      </div>

      <label className="field wide">
        <span>Embedding 模型（可选）</span>
        <input
          name="embeddingModel"
          value={embeddingModel}
          onChange={(event) => setEmbeddingModel(event.target.value)}
          placeholder="例如 text-embedding-3-small；留空关闭语义向量"
          spellCheck={false}
        />
      </label>

      <label className="field wide">
        <span>API Key</span>
        <input
          name="apiKey"
          type="password"
          autoComplete="new-password"
          spellCheck={false}
          placeholder={
            needsKey ? '粘贴 API Key' : `已保存${keyHint ? `（末四位 ${keyHint}）` : ''}，留空保持不变`
          }
        />
      </label>

      <p className="muted small wide">
        {needsKey
          ? '更换服务商后需要重新填写 Key。'
          : 'Key 已加密保存；同步画像、重新登录都不会清除它，留空保存即可保持原 Key。'}
        Embedding 用于语义相似度、相似项目和推荐排序；服务商不支持时留空即可，文本和关键词匹配仍会工作。
        在{' '}
        <a href={provider.keyUrl} target="_blank" rel="noreferrer">
          {provider.name} 控制台
        </a>{' '}
        获取 Key。Key 会加密保存在数据库里，不会写入文件。
      </p>
    </div>
  )
}
