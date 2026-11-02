import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'

const port = process.env.E2E_PORT || '3100'
const locks = ['apps/web/.next-e2e/dev/lock', 'apps/web/.next/dev/lock']

function ps() {
  return spawnSync('ps', ['-ax', '-o', 'pid=,ppid=,command='], { encoding: 'utf8' }).stdout ?? ''
}

function kill(pid, reason) {
  try {
    process.kill(pid, 'SIGKILL')
    console.log(`cleanup-e2e: killed ${reason} (pid ${pid})`)
  } catch {
    // 进程可能已经退出
  }
}

const targets = new Set()

// 1) 锁定文件里如果记录了 pid，且确属 next dev，就清理
for (const lock of locks) {
  if (!existsSync(lock)) continue
  try {
    const pid = Number(readFileSync(lock, 'utf8').match(/\d+/)?.[0])
    if (pid) {
      const line = ps()
        .split('\n')
        .find((row) => row.trim().startsWith(`${pid} `))
      if (line?.includes('next dev')) targets.add(pid)
    }
  } catch {
    // 忽略损坏的 lock
  }
  rmSync(lock, { force: true })
}

// 2) 按端口找残留的 next dev（e2e 专用端口）
for (const line of ps().split('\n')) {
  if (line.includes('next dev') && line.includes(`-p ${port}`)) {
    const pid = Number(line.trim().split(/\s+/)[0])
    if (Number.isFinite(pid)) targets.add(pid)
  }
}

// 3) 连同它们的 next-server 子进程一起清理
const all = ps()
  .split('\n')
  .map((line) => line.trim().split(/\s+/))
  .filter((parts) => parts.length >= 3 && Number.isFinite(Number(parts[0])))
  .map(([pid, ppid, ...command]) => ({ pid: Number(pid), ppid: Number(ppid), command: command.join(' ') }))

for (const process of all) {
  if (targets.has(process.ppid) && process.command.includes('next-server')) {
    targets.add(process.pid)
  }
}

for (const pid of targets) kill(pid, 'stale next dev')
