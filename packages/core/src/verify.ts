import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type VerifyStatus = 'verified' | 'failed' | 'skipped' | 'error'
export type VerifyStack = 'node' | 'python' | 'go' | 'rust' | 'unknown'

export interface PackageJsonShape {
  scripts?: Record<string, string>
}

export interface VerificationPlan {
  stack: VerifyStack
  image: string | null
  commands: string[]
}

export function detectStack(files: string[]): VerifyStack {
  const names = new Set(files)
  if (names.has('package.json')) return 'node'
  if (names.has('pyproject.toml') || names.has('requirements.txt') || names.has('setup.py')) return 'python'
  if (names.has('go.mod')) return 'go'
  if (names.has('Cargo.toml')) return 'rust'
  return 'unknown'
}

export function buildVerificationPlan(files: string[], packageJson: PackageJsonShape | null): VerificationPlan {
  const stack = detectStack(files)
  const names = new Set(files)

  if (stack === 'node') {
    const install = names.has('package-lock.json')
      ? 'npm ci --no-audit --no-fund'
      : 'npm install --no-audit --no-fund'
    const commands = [install]
    if (packageJson?.scripts?.build) commands.push('npm run build')
    else if (packageJson?.scripts?.test) commands.push('npm run test')
    return { stack, image: 'node:22-alpine', commands }
  }

  if (stack === 'python') {
    const install =
      names.has('pyproject.toml') || names.has('setup.py')
        ? 'pip install --no-cache-dir .'
        : 'pip install --no-cache-dir -r requirements.txt'
    return { stack, image: 'python:3.12-alpine', commands: [install] }
  }

  if (stack === 'go') {
    return { stack, image: 'golang:1.23-alpine', commands: ['go build ./...'] }
  }

  if (stack === 'rust') {
    return { stack, image: 'rust:1.83-alpine', commands: ['cargo build --quiet'] }
  }

  return { stack, image: null, commands: [] }
}

export interface RunVerificationOptions {
  repoFullName: string
  /** 使用本地目录代替 git clone（调试 / 测试用） */
  fromPath?: string
  timeoutMs?: number
  logDir?: string
  keepWorkDir?: boolean
}

export interface VerificationResult {
  repoFullName: string
  status: VerifyStatus
  stack: VerifyStack
  commands: string[]
  exitCode: number | null
  durationMs: number
  logPath: string | null
  logTail: string
  commitSha: string | null
  error?: string
}

interface ProcessResult {
  exitCode: number | null
  output: string
  timedOut: boolean
}

function tail(text: string, maxChars = 6000): string {
  const trimmed = text.trim()
  return trimmed.length <= maxChars ? trimmed : `…${trimmed.slice(-maxChars)}`
}

export function runProcess(
  command: string,
  args: string[],
  timeoutMs: number,
  extraEnv: Record<string, string> = {},
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    let output = ''
    let timedOut = false
    let settled = false

    const child = spawn(command, args, { env: { ...process.env, CI: 'true', ...extraEnv } })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)

    child.stdout?.on('data', (data: Buffer) => {
      output += data.toString()
    })
    child.stderr?.on('data', (data: Buffer) => {
      output += data.toString()
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ exitCode: null, output: `${output}\n${error.message}`, timedOut })
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ exitCode: code, output, timedOut })
    })
  })
}

export async function dockerAvailable(): Promise<boolean> {
  const result = await runProcess('docker', ['version', '--format', '{{.Server.Version}}'], 10_000)
  return result.exitCode === 0
}

async function readCommitSha(workDir: string): Promise<string | null> {
  const result = await runProcess('git', ['-C', workDir, 'rev-parse', 'HEAD'], 10_000)
  if (result.exitCode !== 0) return null
  return result.output.trim().split('\n')[0] ?? null
}

export function cloneRepository(
  fullName: string,
  workDir: string,
  token?: string,
): Promise<ProcessResult> {
  const env: Record<string, string> = {}
  if (token) {
    env.GIT_CONFIG_COUNT = '1'
    env.GIT_CONFIG_KEY_0 = 'http.https://github.com/.extraheader'
    env.GIT_CONFIG_VALUE_0 = `Authorization: Bearer ${token}`
  }
  return runProcess(
    'git',
    ['clone', '--depth', '1', '--single-branch', `https://github.com/${fullName}.git`, workDir],
    180_000,
    env,
  )
}

export async function runVerification(options: RunVerificationOptions): Promise<VerificationResult> {
  const startedAt = Date.now()
  const timeoutMs = options.timeoutMs ?? 600_000
  const workDir = options.fromPath ?? (await mkdtemp(join(tmpdir(), 'repo-radar-verify-')))

  let status: VerifyStatus = 'error'
  let stack: VerifyStack = 'unknown'
  let commands: string[] = []
  let exitCode: number | null = null
  let commitSha: string | null = null
  let logText = ''
  let error: string | undefined
  let logPath: string | null = null

  try {
    if (!options.fromPath) {
      const clone = await cloneRepository(options.repoFullName, workDir)
      if (clone.exitCode !== 0) throw new Error(`clone 失败：${tail(clone.output, 500)}`)
    }

    commitSha = await readCommitSha(workDir)
    const files = await readdir(workDir)

    let packageJson: PackageJsonShape | null = null
    if (files.includes('package.json')) {
      try {
        packageJson = JSON.parse(await readFile(join(workDir, 'package.json'), 'utf8')) as PackageJsonShape
      } catch {
        packageJson = null
      }
    }

    const plan = buildVerificationPlan(files, packageJson)
    stack = plan.stack
    commands = plan.commands

    if (!plan.image || plan.commands.length === 0) {
      status = 'skipped'
      logText = `未识别的项目类型。顶层文件：${files.slice(0, 12).join(', ')}`
    } else if (!(await dockerAvailable())) {
      status = 'skipped'
      logText = 'Docker 不可用，跳过执行'
    } else {
      const script = plan.commands.join(' && ')
      const result = await runProcess(
        'docker',
        [
          'run',
          '--rm',
          '--network',
          'bridge',
          '--memory',
          '2g',
          '--cpus',
          '2',
          '--pids-limit',
          '512',
          '--security-opt',
          'no-new-privileges',
          '-e',
          'CI=true',
          '-v',
          `${workDir}:/work`,
          '-w',
          '/work',
          plan.image,
          'sh',
          '-lc',
          script,
        ],
        timeoutMs,
      )
      exitCode = result.exitCode
      logText = tail(result.output, 8000)
      if (result.timedOut) {
        status = 'error'
        error = `执行超时（${Math.round(timeoutMs / 1000)}s）`
      } else {
        status = result.exitCode === 0 ? 'verified' : 'failed'
      }
    }
  } catch (err) {
    status = 'error'
    error = err instanceof Error ? err.message : String(err)
    logText = tail(`${logText}\n${error}`, 8000)
  }

  const durationMs = Date.now() - startedAt

  if (options.logDir) {
    try {
      await mkdir(options.logDir, { recursive: true })
      logPath = join(
        options.logDir,
        `${options.repoFullName.replace(/[^a-zA-Z0-9._-]+/g, '-')}-${startedAt}.log`,
      )
      await writeFile(logPath, logText || '（无输出）\n', 'utf8')
    } catch {
      logPath = null
    }
  }

  if (!options.fromPath && !options.keepWorkDir) {
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
  }

  return {
    repoFullName: options.repoFullName,
    status,
    stack,
    commands,
    exitCode,
    durationMs,
    logPath,
    logTail: tail(logText, 6000),
    commitSha,
    ...(error ? { error } : {}),
  }
}

export interface PatchValidationResult {
  applies: boolean
  buildStatus: VerifyStatus
  commands: string[]
  changedFiles: string[]
  logTail: string
  error?: string
}

export interface ValidatePatchOptions {
  repoFullName: string
  patch: string
  /** 使用本地目录代替 git clone（测试用） */
  fromPath?: string
  token?: string
  runBuild?: boolean
  timeoutMs?: number
  keepWorkDir?: boolean
}

/**
 * 在临时克隆里应用补丁，再把构建/测试放进 Docker 沙箱执行。
 * 只产生验证结果，不会提交、推送或创建 PR。
 */
export async function validatePatch(options: ValidatePatchOptions): Promise<PatchValidationResult> {
  const workDir = options.fromPath ?? (await mkdtemp(join(tmpdir(), 'repo-radar-patch-')))
  let changedFiles: string[] = []
  const commands: string[] = []
  let buildStatus: VerifyStatus = 'skipped'
  let logText = ''
  let error: string | undefined

  try {
    if (!options.fromPath) {
      const clone = await cloneRepository(options.repoFullName, workDir, options.token)
      if (clone.exitCode !== 0) {
        return {
          applies: false,
          buildStatus: 'error',
          commands,
          changedFiles,
          logTail: tail(clone.output, 2000),
          error: 'clone 失败',
        }
      }
    }

    const patchPath = join(workDir, '.repo-radar.patch')
    await writeFile(patchPath, options.patch, { encoding: 'utf8', mode: 0o600 })
    const check = await runProcess('git', ['-C', workDir, 'apply', '--recount', '--check', '.repo-radar.patch'], 60_000)
    if (check.exitCode !== 0) {
      return {
        applies: false,
        buildStatus: 'failed',
        commands,
        changedFiles,
        logTail: tail(check.output, 4000),
        error: '补丁无法应用',
      }
    }

    const apply = await runProcess('git', ['-C', workDir, 'apply', '--recount', '.repo-radar.patch'], 60_000)
    if (apply.exitCode !== 0) {
      return {
        applies: false,
        buildStatus: 'failed',
        commands,
        changedFiles,
        logTail: tail(apply.output, 4000),
        error: '补丁应用失败',
      }
    }

    await rm(patchPath, { force: true }).catch(() => undefined)
    const diff = await runProcess('git', ['-C', workDir, 'diff', '--name-only'], 20_000)
    changedFiles = diff.output
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

    if (options.runBuild === false) {
      return { applies: true, buildStatus, commands, changedFiles, logTail: '已跳过构建验证' }
    }

    const files = await readdir(workDir)
    let packageJson: PackageJsonShape | null = null
    if (files.includes('package.json')) {
      try {
        packageJson = JSON.parse(await readFile(join(workDir, 'package.json'), 'utf8')) as PackageJsonShape
      } catch {
        packageJson = null
      }
    }
    const plan = buildVerificationPlan(files, packageJson)
    commands.push(...plan.commands)

    if (!plan.image || plan.commands.length === 0) {
      buildStatus = 'skipped'
      logText = `未识别的项目类型。顶层文件：${files.slice(0, 12).join(', ')}`
    } else if (!(await dockerAvailable())) {
      buildStatus = 'skipped'
      logText = 'Docker 不可用，已只验证补丁可应用'
    } else {
      const result = await runProcess(
        'docker',
        [
          'run',
          '--rm',
          '--network',
          'bridge',
          '--memory',
          '2g',
          '--cpus',
          '2',
          '--pids-limit',
          '512',
          '--security-opt',
          'no-new-privileges',
          '-e',
          'CI=true',
          '-v',
          `${workDir}:/work`,
          '-w',
          '/work',
          plan.image,
          'sh',
          '-lc',
          plan.commands.join(' && '),
        ],
        options.timeoutMs ?? 300_000,
      )
      logText = tail(result.output, 8000)
      if (result.timedOut) {
        buildStatus = 'error'
        error = '构建验证超时'
      } else {
        buildStatus = result.exitCode === 0 ? 'verified' : 'failed'
      }
    }

    return {
      applies: true,
      buildStatus,
      commands,
      changedFiles,
      logTail: logText,
      ...(error ? { error } : {}),
    }
  } catch (caught) {
    return {
      applies: false,
      buildStatus: 'error',
      commands,
      changedFiles,
      logTail: '',
      error: caught instanceof Error ? caught.message : String(caught),
    }
  } finally {
    if (!options.keepWorkDir && !options.fromPath) {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}
