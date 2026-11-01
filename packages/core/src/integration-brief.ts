import type { IntegrationProject, IntegrationSuggestion } from './integrations.js'

export interface IntegrationBriefMeta {
  generatedAt?: string | null
  focus?: string | null
  usedProjects?: string[]
  auto?: boolean
}

const KIND_LABEL: Record<IntegrationSuggestion['kind'], string> = {
  missing: '缺失功能',
  optimize: '可优化',
}

const ACTION_LABEL: Record<IntegrationSuggestion['action'], string> = {
  try: '值得接入',
  watch: '观望',
}

function repoUrl(fullName: string): string {
  return `https://github.com/${fullName}`
}

function renderSuggestion(suggestion: IntegrationSuggestion, index: number): string {
  const lines = [
    `#### 候选 ${index}：[${suggestion.repo}](${repoUrl(suggestion.repo)})`,
    '',
    `- 类型：${KIND_LABEL[suggestion.kind]}`,
    `- 建议：${ACTION_LABEL[suggestion.action]}`,
    `- 理由：${suggestion.reason}`,
  ]

  if (suggestion.alreadyUsed) {
    lines.push('- 依赖状态：项目依赖中已经存在这个库，按升级/替换评估，不要重复引入。')
  }
  if (suggestion.steps.length > 0) {
    lines.push('- 参考步骤（需要按目标项目实际结构调整）：')
    suggestion.steps.forEach((step, stepIndex) => lines.push(`  ${stepIndex + 1}. ${step}`))
  }

  return lines.join('\n')
}

function renderProject(project: IntegrationProject): string {
  const lines = [
    `## 目标项目：[${project.repo}](${repoUrl(project.repo)})`,
    '',
    `- 项目摘要：${project.summary}`,
  ]

  if (project.gaps.length > 0) {
    lines.push('- 能力缺口 / 优化点：')
    for (const gap of project.gaps) lines.push(`  - ${gap}`)
  } else {
    lines.push('- 能力缺口 / 优化点：未标注，请结合项目现状自行判断。')
  }

  lines.push('')

  if (project.suggestions.length === 0) {
    lines.push('暂无候选建议。请先调研是否需要补充能力，不要为了接入而接入。')
    return lines.join('\n')
  }

  project.suggestions.forEach((suggestion, index) => {
    lines.push(renderSuggestion(suggestion, index + 1), '')
  })

  return lines.join('\n').trimEnd()
}

function renderHeader(projects: IntegrationProject[], meta: IntegrationBriefMeta, single: boolean): string[] {
  const lines = [
    single ? `# RepoRadar 接入任务书 · ${projects[0]?.repo ?? ''}` : '# RepoRadar 接入任务书',
    '',
  ]

  if (meta.generatedAt) lines.push(`> 生成时间：${meta.generatedAt}`)
  if (meta.focus) lines.push(`> 本轮关注：${meta.focus}`)
  if (meta.auto && meta.usedProjects?.length) {
    lines.push(`> 参与项目（AI 自动选择）：${meta.usedProjects.join('、')}`)
  }
  if (lines[lines.length - 1] !== '') lines.push('')

  lines.push(
    '你是一名负责落地改造的资深工程师。请根据下面的项目上下文和候选接入建议，在目标项目中完成接入。',
    '候选来自 GitHub 推荐，必须先在目标项目中核实兼容性和实际 API，再修改代码。',
    '',
    '## 执行要求',
    '',
    '1. 先阅读目标项目的 README、依赖清单、目录结构和现有测试，确认技术栈、包管理器、代码风格和可用的验证命令。',
    '2. 逐个评估候选：是否真的补足缺口、许可证是否兼容、维护状态是否正常、当前版本 API 是否与描述一致。不要照搬建议里的步骤。',
    '3. 开始修改前，先用 3-6 行说明准备改哪些文件、如何验证、主要风险；如果发现候选不适合，明确跳过并说明原因。',
    '4. 只修改目标项目，不修改候选仓库，不引入与任务无关的重构。',
    '5. 保持现有代码风格；安装依赖、修改配置或运行有副作用的命令前先说明。',
    '6. 每个接入点尽量配测试；完成后运行项目已有的 test / lint / typecheck / build。',
    '7. 最后汇报：已完成的接入、改动的文件、验证结果、未完成项与原因、后续建议。',
    '',
  )

  return lines
}

/** 从任务书中移除已接入或不感兴趣的建议；没有剩余建议的项目也会被移除。 */
export function removeHandledSuggestions(
  projects: IntegrationProject[],
  handledPairs: Iterable<string>,
): IntegrationProject[] {
  const handled = new Set([...handledPairs].map((pair) => pair.toLowerCase()))
  return projects
    .map((project) => ({
      ...project,
      suggestions: project.suggestions.filter(
        (suggestion) => !handled.has(`${project.repo}|${suggestion.repo}`.toLowerCase()),
      ),
    }))
    .filter((project) => project.suggestions.length > 0)
}

/**
 * 把接入报告转成可直接交给代码 AI 执行的任务书。
 */
export function buildIntegrationBrief(
  projects: IntegrationProject[],
  meta: IntegrationBriefMeta = {},
): string {
  if (projects.length === 0) return '# RepoRadar 接入任务书\n\n暂无可执行的项目建议。'
  return renderBrief(projects, meta, false)
}

export function buildProjectIntegrationBrief(
  project: IntegrationProject,
  meta: IntegrationBriefMeta = {},
): string {
  return renderBrief([project], meta, true)
}

function renderBrief(
  projects: IntegrationProject[],
  meta: IntegrationBriefMeta,
  singleProjectTitle: boolean,
): string {
  const lines = renderHeader(projects, meta, singleProjectTitle)
  for (const project of projects) {
    lines.push(renderProject(project), '', '---', '')
  }
  lines.push('由 RepoRadar 生成。建议内容由模型生成，接入前请核实。')
  return lines.join('\n').trimEnd()
}
