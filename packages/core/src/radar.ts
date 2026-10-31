export type RadarMode = 'balanced' | 'focus' | 'swap' | 'explore' | 'new'

export interface RadarModeInfo {
  value: RadarMode
  label: string
  description: string
}

export const RADAR_MODES: RadarModeInfo[] = [
  { value: 'balanced', label: '综合', description: '机会和隐藏宝石混合' },
  { value: 'focus', label: '补项目', description: '先看能推进你项目的事' },
  { value: 'swap', label: '换工具', description: '找能替换或补强工具链的项目' },
  { value: 'explore', label: '找灵感', description: '跳出当前栈，看看新方向' },
  { value: 'new', label: '看新东西', description: '只看最近冒出来的小项目' },
]

export function isRadarMode(value: string | undefined | null): value is RadarMode {
  return RADAR_MODES.some((mode) => mode.value === value)
}

export interface RadarPersona {
  name: string
  detail: string
}

/**
 * 用当前维护项目的语言和 topics 生成一个轻量的“雷达人格”，
 * 不调用模型，保证每次刷新稳定。
 */
export function radarPersona(projects: Array<{ language: string | null; topics: string[] }>): RadarPersona {
  const languages = new Set(projects.map((project) => project.language?.toLowerCase()).filter(Boolean))
  const topics = new Set(projects.flatMap((project) => project.topics.map((topic) => topic.toLowerCase())))
  const has = (...values: string[]) => values.some((value) => topics.has(value))
  const lang = (...values: string[]) => values.some((value) => languages.has(value))

  if (lang('typescript', 'javascript') && has('ai', 'ai-agent', 'agent', 'mcp', 'cli')) {
    return { name: '终端工具建造者', detail: '把 AI 能力做进开发者的日常工具' }
  }
  if (lang('python') && has('machine-learning', 'deep-learning', 'llm', 'pytorch', 'ml')) {
    return { name: '模型实验派', detail: '在数据和模型之间找可用的边界' }
  }
  if (lang('go', 'rust') && has('infra', 'infrastructure', 'devops', 'cloud', 'database')) {
    return { name: '基础设施修补匠', detail: '关心稳定性、性能和底层工具' }
  }
  if (lang('typescript', 'javascript') && has('frontend', 'react', 'vue', 'css', 'ui')) {
    return { name: '界面体验派', detail: '把复杂能力做成顺手的界面' }
  }
  if (has('cli', 'developer-tools', 'tooling')) {
    return { name: '开发者工具猎人', detail: '持续寻找能减少摩擦的小工具' }
  }
  if (projects.length > 0) {
    return { name: '开源项目实践者', detail: '边做边找能补位的能力' }
  }
  return { name: '开源雷达观察员', detail: '先建立画像，再让推荐更贴近你' }
}
