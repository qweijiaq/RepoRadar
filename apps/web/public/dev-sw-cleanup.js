// 开发环境里旧的 PWA Service Worker 可能缓存上一版 Next chunk，导致服务端和客户端
// 版本不一致。这个脚本在页面脚本之前执行，确保下一次刷新拿到全新资源。
;(function () {
  if (!('serviceWorker' in navigator)) return
  navigator.serviceWorker
    .getRegistrations()
    .then(function (rs) {
      if (!rs.length) return
      Promise.all(
        rs.map(function (r) {
          return r.unregister()
        }),
      ).then(function () {
        var jobs = []
        if ('caches' in window) {
          jobs.push(
            caches.keys().then(function (keys) {
              return Promise.all(
                keys.map(function (k) {
                  return caches.delete(k)
                }),
              )
            }),
          )
        }
        Promise.all(jobs).then(function () {
          try {
            if (sessionStorage.getItem('radar-sw-cleared') === '1') return
            sessionStorage.setItem('radar-sw-cleared', '1')
            location.reload()
          } catch {
            // 忽略:清理失败不影响页面
          }
        })
      })
    })
    .catch(function () {})
})()
