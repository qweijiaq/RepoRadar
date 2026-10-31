export type SetupAccess = 'ok' | 'locked' | 'invalid-token'

export function isLocalSetupHost(host: string | null | undefined): boolean {
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host ?? '')
}

/**
 * 首次配置页的访问控制：localhost 直接允许；公网必须提供 SETUP_TOKEN。
 */
export function evaluateSetupAccess(input: {
  host: string | null | undefined
  setupToken: string | null | undefined
  submittedToken: string | null | undefined
}): SetupAccess {
  if (isLocalSetupHost(input.host)) return 'ok'
  if (!input.setupToken?.trim()) return 'locked'
  return input.submittedToken?.trim() === input.setupToken.trim() ? 'ok' : 'invalid-token'
}
