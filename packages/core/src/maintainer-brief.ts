import type { MaintainerItem, MaintainerProject, MaintainerReport } from './maintainer.js'

export interface MaintainerBriefMeta {
  generatedAt?: string | null
  warnings?: string[]
}

const PRIORITY_LABEL: Record<MaintainerItem['priority'], string> = {
  now: '现在处理',
  week: '本周处理',
  later: '稍后处理',
}

const KIND_LABEL: Record<MaintainerItem['kind'], string> = {
  issue: 'Issue',
  pull: 'PR',
}

function repoUrl(fullName: string): string {
  return `https://github.com/${fullName}`
}

function renderProject(project: MaintainerProject): string {
  const lines = [
    `## 项目：[${project.repo}](${repoUrl(project.repo)})`,
    '',
    `- 健康分：${project.healthScore}/100`,
    `- 概览：${project.summary}`,
  ]

  if (project.strengths.length > 0) {
    lines.push('- 做得好的地方：')
    for (const strength of project.strengths) lines.push(`  - ${strength}`)
  }
  if (project.risks.length > 0) {
    lines.push('- 风险：')
    for (const risk of project.risks) lines.push(`  - ${risk}`)
  }
  if (project.actions.length > 0) {
    lines.push('- 本周建议动作：')
    project.actions.forEach((action, index) => lines.push(`  ${index + 1}. ${action}`))
  }

  if (project.dependencies.length > 0) {
    lines.push('', '### 依赖升级')
    for (const dependency of project.dependencies) {
      lines.push(
        `- **${dependency.name}**：${dependency.current ?? '未知'} → ${dependency.latest ?? '未知'}（风险：${dependency.risk}）`,
        `  - 原因：${dependency.reason}`,
      )
      dependency.steps.forEach((step, index) => lines.push(`  ${index + 1}. ${step}`))
    }
  }

  if (project.items.length > 0) {
    lines.push('', '### Issue / PR 待办')
    for (const item of project.items) {
      lines.push(
        `- [${KIND_LABEL[item.kind]} #${item.number}](${repoUrl(project.repo)}/${item.kind === 'pull' ? 'pull' : 'issues'}/${item.number}) · ${PRIORITY_LABEL[item.priority]}：${item.title}`,
        `  - 原因：${item.reason}`,
        `  - 建议：${item.action}`,
      )
      if (item.draft) lines.push(`  - 草稿：${item.draft}`)
    }
  }

  return lines.join('\n')
}

/**
 * 把维护周报转成可交给代码 AI 的周任务书。
 */
export function buildMaintainerBrief(
  report: MaintainerReport,
  meta: MaintainerBriefMeta = {},
): string {
  const lines = ['# RepoRadar 维护周报任务书', '']
  if (meta.generatedAt) lines.push(`> 生成时间：${meta.generatedAt}`)
  if (meta.warnings?.length) lines.push(`> 数据提示：${meta.warnings.join('；')}`)
  if (lines[lines.length - 1] !== '') lines.push('')

  lines.push(
    '你是一名负责维护这些开源项目的工程师。请根据下面的健康评估、依赖风险和 Issue/PR 待办，安排并执行本周的维护工作。',
    '',
    '## 执行要求',
    '',
    '1. 先读项目结构、README、依赖清单和现有测试，核实下面的判断，不要直接照做。',
    '2. 先处理「现在处理」的 issue / PR，再处理依赖风险，最后做健康改进。',
    '3. 回复 issue、review PR 或修改代码前，先说明准备做什么、影响范围和验证方式。',
    '4. 不要自动发布、强推 main、删除仓库或关闭 issue；需要这些动作时先停下来询问。',
    '5. 修改代码时保持现有风格，补测试，并运行项目已有的 test / lint / typecheck / build。',
    '6. 最后汇报：处理了哪些项、改了哪些文件、验证结果、哪些没做以及原因。',
    '',
    '---',
    '',
  )

  for (const project of report.projects) {
    lines.push(renderProject(project), '', '---', '')
  }
  lines.push('由 RepoRadar 生成。健康分和优先级是模型判断，执行前请核实。')
  return lines.join('\n').trimEnd()
}
