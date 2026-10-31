const DEV_FALLBACK = 'repo-radar-insecure-dev-secret'
let warned = false

/**
 * AUTH_SECRET 同时用于 Auth.js 会话和数据库里的加密字段。
 * 生产环境必须显式配置；开发环境才允许使用固定兜底值。
 */
export function requireAuthSecret(): string {
  const secret = process.env.AUTH_SECRET?.trim()
  if (secret) return secret
  if (process.env.NODE_ENV === 'production') {
    throw new Error('AUTH_SECRET 未配置。生产环境必须设置 AUTH_SECRET，否则已加密的令牌和密钥无法安全保存。')
  }
  if (!warned) {
    warned = true
    console.warn('[security] 未设置 AUTH_SECRET，开发环境使用固定的不安全兜底值。')
  }
  return DEV_FALLBACK
}

export function hasAuthSecret(): boolean {
  return Boolean(process.env.AUTH_SECRET?.trim())
}
