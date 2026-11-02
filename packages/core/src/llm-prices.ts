import type { DbPool } from './db.js'

export interface ModelPrice {
  /** 每 100 万输入 token 的美元价格 */
  input: number
  /** 每 100 万输出 token 的美元价格 */
  output: number
}

export type LlmPriceMap = Record<string, ModelPrice>

export interface ModelUsageRow {
  model: string
  calls: number
  promptTokens: number
  completionTokens: number
}

export interface PricedModelUsage extends ModelUsageRow {
  price: ModelPrice | null
  cost: number | null
}

const SETTINGS_KEY = 'llm_prices'

function isPrice(value: unknown): value is ModelPrice {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.input === 'number' &&
    Number.isFinite(record.input) &&
    record.input >= 0 &&
    typeof record.output === 'number' &&
    Number.isFinite(record.output) &&
    record.output >= 0
  )
}

/** 清洗外部输入：只保留合法的 model -> {input, output}。 */
export function normalizePriceMap(input: unknown): LlmPriceMap {
  if (!input || typeof input !== 'object') return {}
  const prices: LlmPriceMap = {}
  for (const [model, value] of Object.entries(input as Record<string, unknown>)) {
    const name = model.trim()
    if (!name || !isPrice(value)) continue
    prices[name] = { input: value.input, output: value.output }
  }
  return prices
}

export async function loadLlmPrices(pool: DbPool): Promise<LlmPriceMap> {
  try {
    const { rows } = await pool.query<{ value: unknown }>(
      `SELECT value FROM app_settings WHERE key = $1`,
      [SETTINGS_KEY],
    )
    return normalizePriceMap(rows[0]?.value)
  } catch {
    return {}
  }
}

export async function saveLlmPrices(pool: DbPool, prices: LlmPriceMap): Promise<void> {
  const clean = normalizePriceMap(prices)
  if (Object.keys(clean).length === 0) {
    await clearLlmPrices(pool)
    return
  }
  await pool.query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [SETTINGS_KEY, JSON.stringify(clean)],
  )
}

export async function clearLlmPrices(pool: DbPool): Promise<void> {
  await pool.query(`DELETE FROM app_settings WHERE key = $1`, [SETTINGS_KEY])
}

/** 近 N 天按模型聚合 token 用量（llm_usage 已按每次调用记录）。 */
export async function loadUsageByModel(pool: DbPool, days = 30): Promise<ModelUsageRow[]> {
  const { rows } = await pool.query<{
    model: string
    calls: string
    prompt_tokens: string
    completion_tokens: string
  }>(
    `SELECT model,
            count(*) AS calls,
            COALESCE(sum(prompt_tokens), 0) AS prompt_tokens,
            COALESCE(sum(completion_tokens), 0) AS completion_tokens
     FROM llm_usage
     WHERE created_at >= now() - ($1::int * INTERVAL '1 day')
     GROUP BY model
     ORDER BY count(*) DESC, model`,
    [days],
  )
  return rows.map((row) => ({
    model: row.model,
    calls: Number(row.calls),
    promptTokens: Number(row.prompt_tokens),
    completionTokens: Number(row.completion_tokens),
  }))
}

/** 按「每 100 万 token」的单价估算美元成本。 */
export function estimateCost(
  promptTokens: number,
  completionTokens: number,
  price: ModelPrice,
): number {
  const value =
    (Math.max(0, promptTokens) / 1_000_000) * price.input +
    (Math.max(0, completionTokens) / 1_000_000) * price.output
  return Math.round(value * 1_000_000) / 1_000_000
}

export function priceUsage(rows: ModelUsageRow[], prices: LlmPriceMap): PricedModelUsage[] {
  return rows.map((row) => {
    const price = prices[row.model] ?? null
    return {
      ...row,
      price,
      cost: price ? estimateCost(row.promptTokens, row.completionTokens, price) : null,
    }
  })
}

export function totalCost(rows: PricedModelUsage[]): number {
  return Math.round(rows.reduce((sum, row) => sum + (row.cost ?? 0), 0) * 1_000_000) / 1_000_000
}
