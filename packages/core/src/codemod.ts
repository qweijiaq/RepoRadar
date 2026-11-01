import { parse, type ParserPlugin } from '@babel/parser'
import traverse from '@babel/traverse'
import { createTwoFilesPatch } from 'diff'

export interface CodemodResult {
  changed: boolean
  code: string
  rewrites: number
}

interface Replacement {
  start: number
  end: number
  value: string
}

const SCRIPT_EXTENSION = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i

function quoteLike(original: string, value: string): string {
  const quote = original.startsWith("'") ? "'" : '"'
  const escaped = value.replace(/\\/g, '\\\\').replace(new RegExp(quote, 'g'), `\\${quote}`)
  return `${quote}${escaped}${quote}`
}

/**
 * 把 import / export from / require() 里的模块名从旧包换成新包。
 * 只改模块说明符，不动本地变量名和调用方式——API 差异交给模型或人工。
 */
export function rewriteModuleSpecifiers(
  source: string,
  fromPackage: string,
  toPackage: string,
  filePath = 'file.ts',
): CodemodResult {
  if (!SCRIPT_EXTENSION.test(filePath)) return { changed: false, code: source, rewrites: 0 }

  const isTypeScript = /\.(ts|tsx|mts|cts)$/i.test(filePath)
  const plugins: ParserPlugin[] = ['jsx', 'decorators-legacy']
  if (isTypeScript) plugins.unshift('typescript')
  const ast = parse(source, {
    sourceType: 'unambiguous',
    errorRecovery: true,
    plugins,
  })

  const replacements: Replacement[] = []
  const rewrite = (value: string): string => {
    if (value === fromPackage) return toPackage
    if (value.startsWith(`${fromPackage}/`)) return `${toPackage}${value.slice(fromPackage.length)}`
    return value
  }

  const consider = (node: unknown): void => {
    const literal = node as {
      type?: string
      start?: number | null
      end?: number | null
      value?: unknown
      extra?: { raw?: string }
    } | null
    if (!literal || literal.type !== 'StringLiteral') return
    if (typeof literal.start !== 'number' || typeof literal.end !== 'number') return
    if (typeof literal.value !== 'string') return
    const next = rewrite(literal.value)
    if (next === literal.value) return
    replacements.push({
      start: literal.start,
      end: literal.end,
      value: quoteLike(literal.extra?.raw ?? `"${literal.value}"`, next),
    })
  }

  traverse(ast, {
    ImportDeclaration(path) {
      consider(path.node.source)
    },
    ExportNamedDeclaration(path) {
      consider(path.node.source)
    },
    ExportAllDeclaration(path) {
      consider(path.node.source)
    },
    CallExpression(path) {
      const callee = path.node.callee
      if (callee.type !== 'Identifier' || callee.name !== 'require') return
      if (path.node.arguments.length !== 1) return
      consider(path.node.arguments[0])
    },
  })

  if (replacements.length === 0) return { changed: false, code: source, rewrites: 0 }

  let code = source
  for (const replacement of [...replacements].sort((left, right) => right.start - left.start)) {
    code = code.slice(0, replacement.start) + replacement.value + code.slice(replacement.end)
  }
  return { changed: true, code, rewrites: replacements.length }
}

/** 生成 git apply 可用的单文件 patch。 */
export function buildFilePatch(filePath: string, before: string, after: string): string {
  const diff = createTwoFilesPatch(`a/${filePath}`, `b/${filePath}`, before, after, '', '', {
    context: 3,
  })
  // createTwoFilesPatch 以 ---/+++ 开头，补一行 diff --git 让 git apply 更稳。
  return `diff --git a/${filePath} b/${filePath}\n${diff}`
}

/** 在 package.json 文本里把旧依赖换成新依赖（版本写成 latest）。 */
export function swapDependencyInJson(
  manifest: string,
  fromPackage: string,
  toPackage: string,
): string | null {
  const escaped = fromPackage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`"${escaped}"\\s*:\\s*"[^"]*"`, 'm')
  if (!pattern.test(manifest)) return null
  if (new RegExp(`"${toPackage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*:`).test(manifest)) {
    return null
  }
  return manifest.replace(pattern, `"${toPackage}": "latest"`)
}

export interface MechanicalSwapInput {
  manifestName: string | null
  manifest: string | null
  targetFile: { path: string; content: string } | null
  fromPackage: string
  toPackage: string
}

export interface MechanicalSwapResult {
  patch: string
  files: string[]
  summary: string
}

/**
 * 不调用模型的最小换库补丁：改 package.json 依赖 + 重写目标文件里的 import。
 * 适合 API 兼容的替换；不兼容时沙箱会失败，但补丁本身仍然可读。
 */
export function buildMechanicalSwapPatch(input: MechanicalSwapInput): MechanicalSwapResult | null {
  const patches: string[] = []
  const files: string[] = []
  const notes: string[] = []

  if (input.manifestName === 'package.json' && input.manifest) {
    const nextManifest = swapDependencyInJson(
      input.manifest,
      input.fromPackage,
      input.toPackage,
    )
    if (nextManifest && nextManifest !== input.manifest) {
      patches.push(buildFilePatch('package.json', input.manifest, nextManifest))
      files.push('package.json')
      notes.push(`依赖 ${input.fromPackage} → ${input.toPackage}`)
    }
  }

  if (input.targetFile) {
    const result = rewriteModuleSpecifiers(
      input.targetFile.content,
      input.fromPackage,
      input.toPackage,
      input.targetFile.path,
    )
    if (result.changed) {
      patches.push(buildFilePatch(input.targetFile.path, input.targetFile.content, result.code))
      files.push(input.targetFile.path)
      notes.push(`${input.targetFile.path} 重写 ${result.rewrites} 处 import`)
    }
  }

  if (patches.length === 0) return null
  return {
    patch: patches.join(''),
    files,
    summary: `机械换库：${notes.join('；')}。只替换了模块名，API 差异需要人工确认。`,
  }
}
