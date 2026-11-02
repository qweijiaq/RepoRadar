import { describe, expect, it } from 'vitest'
import {
  estimateCost,
  normalizePriceMap,
  priceUsage,
  totalCost,
} from '../src/llm-prices.js'

describe('estimateCost', () => {
  it('prices input and output per million tokens', () => {
    expect(estimateCost(1_000_000, 1_000_000, { input: 0.14, output: 0.28 })).toBeCloseTo(0.42)
    expect(estimateCost(500_000, 250_000, { input: 2, output: 8 })).toBeCloseTo(3)
    expect(estimateCost(0, 0, { input: 1, output: 1 })).toBe(0)
  })
})

describe('normalizePriceMap', () => {
  it('keeps only valid non-negative numbers', () => {
    expect(
      normalizePriceMap({
        'deepseek-flash': { input: 0.14, output: 0.28 },
        broken: { input: -1, output: 2 },
        text: 'nope',
        '  ': { input: 1, output: 1 },
      }),
    ).toEqual({ 'deepseek-flash': { input: 0.14, output: 0.28 } })
  })
})

describe('priceUsage', () => {
  it('prices known models and leaves unknown ones unpriced', () => {
    const priced = priceUsage(
      [
        { model: 'known', calls: 2, promptTokens: 1_000_000, completionTokens: 0 },
        { model: 'unknown', calls: 1, promptTokens: 10, completionTokens: 10 },
      ],
      { known: { input: 1, output: 2 } },
    )
    expect(priced[0]?.cost).toBe(1)
    expect(priced[1]?.cost).toBeNull()
    expect(totalCost(priced)).toBe(1)
  })
})
