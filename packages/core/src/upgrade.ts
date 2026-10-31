import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cloneRepository, dockerAvailable, runProcess, type PackageJsonShape, type VerifyStatus } from './verify.js'

export interface DependencyUpgradeOptions {
  repoFullName: string
  packageName: string
  targetVersion: string
  /** 使用本地目录代替 git clone（测试用） */
  fromPath?: string
  token?: string
  timeoutMs?: number
  keepWorkDir?: boolean
}

export interface DependencyUpgradeResult {
  applied: boolean
  buildStatus: VerifyStatus
  commands: string[]
  changedFiles: string[]
  patch: string
  logTail: string
  error?: string
}

const PACKAGE_PATTERN = /^(@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/
const VERSION_PATTERN = /^[A-Za-z0-9._+~-]{1,40}$/

function tail(text: string, maxChars = 6000): string {
  const trimmed = text.trim()
  return trimmed.length <= maxChars ? trimmed : `…${trimmed.slice(-maxChars)}`
}

async function readPackageJson(workDir: string): Promise<PackageJsonShape | null> {
  try {
    return JSON.parse(await readFile(join(workDir, 'package.json'), 'utf8')) as PackageJsonShape
  } catch {
    return null
  }
}

function nodeInstallCommand(files: string[], packageName: string, version: string): string {
  const spec = `${packageName}@${version}`
  if (files.includes('pnpm-lock.yaml')) return `corepack enable >/dev/null 2>&1 || true; pnpm add '${spec}'`
  if (files.includes('yarn.lock')) return `corepack enable >/dev/null 2>&1 || true; yarn add '${spec}'`
  return `npm install '${spec}' --no-audit --no-fund`
}

function nodeBuildCommand(packageJson: PackageJsonShape | null): string | null {
  if (packageJson?.scripts?.build) return 'npm run build'
  if (packageJson?.scripts?.test) return 'npm test'
  return null
}

async function updatePythonRequirements(workDir: string, packageName: string, version: string): Promise<boolean> {
  for (const file of ['requirements.txt', 'requirements-dev.txt']) {
    let text: string
    try {
      text = await readFile(join(workDir, file), 'utf8')
    } catch {
      continue
    }
    const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(`^(${escaped})\\s*(?:==|>=|~=|>|<=|<)?\\s*[^\\s#]*`, 'm')
    if (!pattern.test(text)) continue
    const updated = text.replace(pattern, `$1==${version}`)
    await writeFile(join(workDir, file), updated, 'utf8')
    return true
  }
  return false
}

/**
 * 在临时克隆和 Docker 沙箱里执行依赖升级，返回完整 diff。
 * 不提交、不推送、不创建 PR；build/test 失败时仍返回补丁供人工审阅。
 */
export async function runDependencyUpgrade(options: DependencyUpgradeOptions): Promise<DependencyUpgradeResult> {
  if (!PACKAGE_PATTERN.test(options.packageName)) {
    return { applied: false, buildStatus: 'error', commands: [], changedFiles: [], patch: '', logTail: '', error: '包名不合法' }
  }
  if (!VERSION_PATTERN.test(options.targetVersion)) {
    return { applied: false, buildStatus: 'error', commands: [], changedFiles: [], patch: '', logTail: '', error: '版本号不合法' }
  }

  const workDir = options.fromPath ?? (await mkdtemp(join(tmpdir(), 'repo-radar-upgrade-')))
  const commands: string[] = []
  let buildStatus: VerifyStatus = 'skipped'
  let logText = ''
  let error: string | undefined
  let applied = false
  let changedFiles: string[] = []
  let patch = ''

  try {
    if (!options.fromPath) {
      const clone = await cloneRepository(options.repoFullName, workDir, options.token)
      if (clone.exitCode !== 0) {
        return { applied: false, buildStatus: 'error', commands, changedFiles, patch, logTail: tail(clone.output, 2000), error: 'clone 失败' }
      }
    }

    const files = await readdir(workDir)
    const packageJson = files.includes('package.json') ? await readPackageJson(workDir) : null

    let image: string | null = null
    let script = ''

    if (files.includes('package.json')) {
      image = 'node:22-alpine'
      const install = nodeInstallCommand(files, options.packageName, options.targetVersion)
      const build = nodeBuildCommand(packageJson)
      commands.push(install, ...(build ? [build] : []))
      script = [install, build].filter(Boolean).join(' && ')
    } else if (files.includes('go.mod')) {
      image = 'golang:1.23-alpine'
      script = `go get '${options.packageName}@${options.targetVersion}' && go mod tidy && go build ./...`
      commands.push(`go get ${options.packageName}@${options.targetVersion}`, 'go mod tidy', 'go build ./...')
    } else if (files.includes('Cargo.toml')) {
      image = 'rust:1.83-alpine'
      script = `cargo update -p '${options.packageName}' --precise '${options.targetVersion}' && cargo build --quiet`
      commands.push(`cargo update -p ${options.packageName} --precise ${options.targetVersion}`, 'cargo build')
    } else if (files.includes('requirements.txt') || files.includes('requirements-dev.txt')) {
      const updated = await updatePythonRequirements(workDir, options.packageName, options.targetVersion)
      if (!updated) {
        return {
          applied: false,
          buildStatus: 'skipped',
          commands,
          changedFiles,
          patch,
          logTail: '',
          error: '在 requirements 文件中没有找到这个依赖',
        }
      }
      applied = true
      buildStatus = 'skipped'
      logText = '已更新 requirements.txt；Python 项目未执行完整构建。'
      commands.push('edit requirements.txt')
    } else {
      return {
        applied: false,
        buildStatus: 'skipped',
        commands,
        changedFiles,
        patch,
        logTail: '',
        error: '暂不支持这个项目的依赖文件类型',
      }
    }

    if (image && script) {
      if (!(await dockerAvailable())) {
        return {
          applied: false,
          buildStatus: 'skipped',
          commands,
          changedFiles,
          patch,
          logTail: '',
          error: 'Docker 不可用，无法在沙箱里执行升级',
        }
      }
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
          image,
          'sh',
          '-lc',
          script,
        ],
        options.timeoutMs ?? 420_000,
      )
      logText = tail(result.output, 8000)
      applied = true
      if (result.timedOut) {
        buildStatus = 'error'
        error = '升级验证超时'
      } else {
        buildStatus = result.exitCode === 0 ? 'verified' : 'failed'
      }
    }

    const diff = await runProcess('git', ['-C', workDir, 'diff', '--binary'], 30_000)
    patch = diff.output.trim()
    const names = await runProcess('git', ['-C', workDir, 'diff', '--name-only'], 20_000)
    changedFiles = names.output.split('\n').map((line) => line.trim()).filter(Boolean)

    if (!patch) {
      applied = false
      error = error ?? '升级没有产生文件改动（可能已经是最新版本）'
    }

    return {
      applied,
      buildStatus,
      commands,
      changedFiles,
      patch: patch ? `${patch}\n` : '',
      logTail: logText,
      ...(error ? { error } : {}),
    }
  } catch (caught) {
    return {
      applied: false,
      buildStatus: 'error',
      commands,
      changedFiles,
      patch,
      logTail: logText,
      error: caught instanceof Error ? caught.message : String(caught),
    }
  } finally {
    if (!options.keepWorkDir && !options.fromPath) {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}
