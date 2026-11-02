import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const port = Number(process.env.SMOKE_PORT || 3300)
const base = `http://127.0.0.1:${port}`

try {
  process.loadEnvFile('.env')
} catch {
  // 可选
}

const child = spawn(
  'pnpm',
  ['--filter', '@repo-radar/web', 'exec', 'next', 'start', '-p', String(port)],
  {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      RADAR_BASE_URL: process.env.RADAR_BASE_URL || base,
    },
  },
)

let exited = false
child.on('exit', (code) => {
  exited = true
  if (code) console.error(`smoke-prod: next start exited with ${code}`)
})

async function waitFor(url, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (exited) throw new Error('next start exited before becoming ready')
    try {
      const response = await fetch(url)
      if (response.ok) return response
    } catch {
      // 还没起来
    }
    await sleep(500)
  }
  throw new Error(`timed out waiting for ${url}`)
}

try {
  await waitFor(`${base}/api/health`)
  console.log('✓ /api/health')

  const checks = [
    ['/login', '进入你的雷达'],
    ['/privacy', '隐私说明'],
    ['/terms', '服务条款'],
  ]
  for (const [path, text] of checks) {
    const response = await fetch(`${base}${path}`)
    const body = await response.text()
    if (!response.ok) throw new Error(`${path} returned ${response.status}`)
    if (!body.includes(text)) throw new Error(`${path} missing expected text: ${text}`)
    console.log(`✓ ${path}`)
  }
  console.log('smoke-prod: passed')
} catch (error) {
  console.error('smoke-prod: failed —', error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  child.kill('SIGTERM')
  await sleep(1000)
  if (!exited) child.kill('SIGKILL')
}
