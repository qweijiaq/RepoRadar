import { NextResponse } from 'next/server'
import { loadOpsMetrics, renderPrometheus } from '@repo-radar/core'
import { getPool } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<NextResponse> {
  const token = process.env.METRICS_TOKEN?.trim()
  if (!token) {
    return new NextResponse('METRICS_TOKEN is not configured\n', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  }
  if (request.headers.get('authorization') !== `Bearer ${token}`) {
    return new NextResponse('unauthorized\n', {
      status: 401,
      headers: { 'www-authenticate': 'Bearer', 'content-type': 'text/plain; charset=utf-8' },
    })
  }
  try {
    const metrics = await loadOpsMetrics(getPool())
    const body = renderPrometheus({ ...metrics, uptimeSeconds: Math.round(process.uptime()) })
    return new NextResponse(body, {
      headers: { 'content-type': 'text/plain; version=0.0.4; charset=utf-8', 'cache-control': 'no-store' },
    })
  } catch (error) {
    console.error('[metrics] query failed:', error)
    return new NextResponse('database error\n', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  }
}
