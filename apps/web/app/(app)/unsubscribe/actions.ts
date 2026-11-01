'use server'

import {
  DEFAULT_NOTIFICATION_PREFS,
  findUserById,
  saveNotificationPrefs,
  verifyUnsubscribeToken,
  getPool,
} from '@repo-radar/core'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

export async function unsubscribeAction(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '')
  const userId = verifyUnsubscribeToken(token)
  if (!userId) redirect('/unsubscribe?status=invalid')

  const pool = getPool()
  const user = await findUserById(pool, userId)
  if (!user) redirect('/unsubscribe?status=invalid')

  await saveNotificationPrefs(pool, userId, {
    ...(user.prefs.notificationPrefs ?? DEFAULT_NOTIFICATION_PREFS),
    emailNotifications: false,
    weeklyDigest: false,
  })
  revalidatePath('/settings')
  redirect('/unsubscribe?status=done')
}
