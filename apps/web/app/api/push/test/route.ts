import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getPool } from '@/lib/db'
import { sendPushToUser } from '@/lib/push'
import { sessionUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

export async function POST(): Promise<NextResponse> {
  const session = await auth()
  const currentUser = sessionUser(session)
  if (!currentUser) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const result = await sendPushToUser(getPool(), Number(currentUser.id), {
      title: 'RepoRadar 测试推送',
      body: '如果你看到这条消息，浏览器推送已配置成功。',
      url: '/inbox',
    })
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '发送失败' },
      { status: 500 },
    )
  }
}
