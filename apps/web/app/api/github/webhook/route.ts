import { createHmac, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { handleGitHubWebhook, type GitHubWebhookPayload } from '@repo-radar/core'
import { getPool } from '@/lib/db'
import { resolveGithubWebhookSecret } from '@/lib/webhook-config'

export const dynamic = 'force-dynamic'

function verifySignature(secret: string, body: string, signature: string | null): boolean {
  if (!signature?.startsWith('sha256=')) return false
  const expected = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
  const left = Buffer.from(expected)
  const right = Buffer.from(signature)
  return left.length === right.length && timingSafeEqual(left, right)
}

export async function POST(request: Request): Promise<NextResponse> {
  const resolved = await resolveGithubWebhookSecret()
  if (!resolved) return NextResponse.json({ error: 'webhook-not-configured' }, { status: 503 })
  const secret = resolved.secret

  const body = await request.text()
  if (!verifySignature(secret, body, request.headers.get('x-hub-signature-256'))) {
    return NextResponse.json({ error: 'invalid-signature' }, { status: 401 })
  }

  const eventName = request.headers.get('x-github-event') ?? ''
  const deliveryId = request.headers.get('x-github-delivery') ?? ''
  if (!eventName || !deliveryId) return NextResponse.json({ error: 'missing-event' }, { status: 400 })

  let payload: GitHubWebhookPayload
  try {
    payload = JSON.parse(body) as GitHubWebhookPayload
  } catch {
    return NextResponse.json({ error: 'invalid-json' }, { status: 400 })
  }

  try {
    const notified = await handleGitHubWebhook(getPool(), eventName, deliveryId, payload)
    return NextResponse.json({ ok: true, notified })
  } catch (error) {
    console.error('[webhook] 处理失败：', error)
    return NextResponse.json({ error: 'handler-failed' }, { status: 500 })
  }
}
