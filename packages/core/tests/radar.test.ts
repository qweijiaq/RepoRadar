import { describe, expect, it } from 'vitest'
import { isRadarMode, RADAR_MODES, radarPersona } from '../src/radar.js'

describe('radar modes', () => {
  it('validates known modes', () => {
    expect(isRadarMode('focus')).toBe(true)
    expect(isRadarMode('nope')).toBe(false)
    expect(RADAR_MODES.map((mode) => mode.value)).toContain('explore')
  })

  it('builds a stable persona from current projects', () => {
    const persona = radarPersona([
      { language: 'TypeScript', topics: ['ai-agent', 'cli'] },
      { language: 'TypeScript', topics: ['mcp'] },
    ])
    expect(persona.name).toBe('终端工具建造者')
    expect(persona.detail.length).toBeGreaterThan(5)
  })

  it('falls back for projects without a clear archetype', () => {
    expect(radarPersona([{ language: 'Go', topics: ['web'] }]).name).toBe('开源项目实践者')
    expect(radarPersona([]).name).toBe('开源雷达观察员')
  })
})
