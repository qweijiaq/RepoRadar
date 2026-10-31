self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { title: 'RepoRadar', body: event.data ? event.data.text() : '' }
  }
  const title = payload.title || 'RepoRadar'
  const options = {
    body: payload.body || '有新的项目动态',
    icon: '/icon.svg',
    badge: '/icon.svg',
    data: { url: payload.url || '/inbox' },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data && event.notification.data.url ? event.notification.data.url : '/inbox'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if ('focus' in client) {
          client.focus()
          if ('navigate' in client) return client.navigate(url)
          return
        }
      }
      return clients.openWindow(url)
    }),
  )
})
