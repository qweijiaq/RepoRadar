import { NextResponse, type NextRequest } from 'next/server'

function createNonce(): string {
  return btoa(crypto.randomUUID())
}

function contentSecurityPolicy(nonce: string, secure: boolean): string {
  const development = process.env.NODE_ENV !== 'production'
  const scriptSrc = `'self' 'nonce-${nonce}'${development ? " 'unsafe-eval'" : ''}`
  const connectSrc = `'self'${development ? ' ws: wss:' : ''}`
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connectSrc}`,
    "media-src 'none'",
    "object-src 'none'",
    "frame-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    ...(secure ? ['upgrade-insecure-requests'] : []),
  ].join('; ')
}

export function proxy(request: NextRequest): NextResponse {
  const nonce = createNonce()
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase()
  const secure = request.nextUrl.protocol === 'https:' || forwardedProto === 'https'
  const csp = contentSecurityPolicy(nonce, secure)
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('content-security-policy', csp)

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('content-security-policy', csp)
  response.headers.set('x-content-type-options', 'nosniff')
  response.headers.set('x-frame-options', 'DENY')
  response.headers.set('referrer-policy', 'strict-origin-when-cross-origin')
  response.headers.set(
    'permissions-policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  )
  response.headers.set('cross-origin-opener-policy', 'same-origin')
  if (secure) {
    response.headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains')
  }
  return response
}

export const config = {
  matcher: ['/((?!_next/|favicon.ico|icon.svg|manifest.webmanifest|sw.js).*)'],
}
