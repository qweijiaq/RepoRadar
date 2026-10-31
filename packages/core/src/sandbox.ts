import { spawn } from 'node:child_process'

export const SANDBOX_UID = 1000
export const SANDBOX_GID = 1000

function sandboxIdentity(): { uid: number; gid: number } {
  const uid = typeof process.getuid === 'function' ? process.getuid() : SANDBOX_UID
  const gid = typeof process.getgid === 'function' ? process.getgid() : SANDBOX_GID
  // worker 容器通常以 root 启动；沙箱本身不能跟随 root。
  if (uid === 0) return { uid: SANDBOX_UID, gid: SANDBOX_GID }
  return { uid, gid }
}

/**
 * worker 以 root 运行时，克隆目录归 root 所有；把临时工作目录交给沙箱用户，
 * 避免容器内以 root 写入。fromPath 调试目录不会被这个函数处理。
 */
export async function prepareSandboxWorkDir(workDir: string): Promise<void> {
  const identity = sandboxIdentity()
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) return
  await new Promise<void>((resolve, reject) => {
    const child = spawn('chown', ['-R', `${identity.uid}:${identity.gid}`, workDir], { stdio: 'ignore' })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`无法把沙箱目录交给非 root 用户（exit ${code}）`))
    })
  })
}

export interface SandboxCommandOptions {
  image: string
  workDir: string
  script: string
}

/**
 * Docker CLI arguments shared by repository verification and patch sandboxes.
 * The container runs as the invoking host user, without Linux capabilities,
 * with a read-only root filesystem and writable tmpfs for caches.
 */
export function sandboxDockerArgs(options: SandboxCommandOptions): string[] {
  const { uid, gid } = sandboxIdentity()
  return [
    'run',
    '--rm',
    '--init',
    '--network',
    'bridge',
    '--memory',
    '2g',
    '--cpus',
    '2',
    '--pids-limit',
    '512',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--read-only',
    '--tmpfs',
    '/tmp:rw,nosuid,nodev,size=1g',
    '--tmpfs',
    '/run:rw,noexec,nosuid,size=64m',
    '--ulimit',
    'nofile=1024:1024',
    '--user',
    `${uid}:${gid}`,
    '-e',
    'CI=true',
    '-e',
    'HOME=/tmp',
    '-e',
    'npm_config_cache=/tmp/npm-cache',
    '-e',
    'PIP_CACHE_DIR=/tmp/pip-cache',
    '-e',
    'GOCACHE=/tmp/go-cache',
    '-e',
    'GOPATH=/tmp/go',
    '-e',
    'CARGO_HOME=/tmp/cargo',
    '-v',
    `${options.workDir}:/work`,
    '-w',
    '/work',
    options.image,
    'sh',
    '-lc',
    options.script,
  ]
}
