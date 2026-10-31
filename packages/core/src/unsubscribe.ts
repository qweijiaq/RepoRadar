import { createHmac, timingSafeEqual } from 'node:crypto'
import { requireAuthSecret } from './secret-key.js'

const PREFIX = 'unsubscribe:v1:'

function signature(userId: number): string {
  return createHmac('sha256', requireAuthSecret()).update(`${PREFIX}${userId}`).digest('base64url')
}

export function createUnsubscribeToken(userId: number): string {
  return `${userId}.${signature(userId)}`
}

export function verifyUnsubscribeToken(token: string): number | null {
  const [payload, provided] = token.split('.')
  if (!payload || !provided || !/^\d+$/.test(payload)) return null
  const expected = signature(Number(payload))
  const left = Buffer.from(provided)
  const right = Buffer.from(expected)
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null
  return Number(payload)
}

export function appendUnsubscribeFooter(
  html: string,
  text: string,
  userId: number,
  baseUrl: string,
): { html: string; text: string } {
  const url = `${baseUrl.replace(/\/+$/, '')}/unsubscribe?token=${encodeURIComponent(createUnsubscribeToken(userId))}`
  const htmlFooter = `<p style="color:#8b95a7;font-size:12px;margin-top:28px;">不想再收到每周精选？<a href="${url}" style="color:#6ea8fe;">退订每周精选和邮件通知</a></p>`
  const textFooter = `\n\n---\n退订每周精选和邮件通知：${url}\n`
  return {
    html: html.includes('</body>') ? html.replace('</body>', `${htmlFooter}\n</body>`) : `${html}\n${htmlFooter}`,
    text: `${text.trimEnd()}${textFooter}`,
  }
}
