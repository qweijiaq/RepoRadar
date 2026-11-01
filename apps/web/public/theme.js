try {
  var t = localStorage.getItem('radar-theme')
  document.documentElement.dataset.theme = t === 'dark' ? 'dark' : 'light'
} catch {
  document.documentElement.dataset.theme = 'light'
}
