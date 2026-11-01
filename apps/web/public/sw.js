const CACHE_VERSION = 'radar-v3'
const STATIC_CACHE = `${CACHE_VERSION}-static`
const OFFLINE_URL = '/offline.html'
const PRECACHE = [OFFLINE_URL, '/offline.css', '/icon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => !key.startsWith(CACHE_VERSION)).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cached = await caches.match(request)
        return cached || caches.match(OFFLINE_URL)
      }),
    )
    return
  }

  if (url.pathname.startsWith('/_next/static/')) {
    // 构建产物必须优先走网络，否则开发重启或部署后可能拿到旧 JS，导致 hydration 失败。
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone()
            void caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy))
          }
          return response
        })
        .catch(async () => (await caches.match(request)) || Response.error()),
    )
    return
  }

  if (/\.(?:css|js|svg|png|webp|woff2?)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached
        return fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone()
            void caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy))
          }
          return response
        })
      }),
    )
  }
})

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
