import { createRequire } from 'node:module'
import { splitCodeChunks, type CodeSymbolPart } from '@repo-radar/core'

const require = createRequire(import.meta.url)

interface SyntaxNode {
  type: string
  text: string
  startIndex: number
  endIndex: number
  children: SyntaxNode[]
  childForFieldName(name: string): SyntaxNode | null
}

interface Tree {
  rootNode: SyntaxNode
}

interface Language {
  readonly __language?: never
}

interface ParserInstance {
  setLanguage(language: Language): void
  parse(input: string): Tree
}

interface ParserConstructor {
  new (): ParserInstance
  init(): Promise<void>
  Language: { load(path: string): Promise<Language> }
}

// tree-sitter 0.20 的 CJS 包默认导出 Parser 类；用 require 加载以避开它的全局类型声明。
const Parser = require('web-tree-sitter-020') as ParserConstructor

const GRAMMAR_BY_EXTENSION: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  go: 'go',
  rs: 'rust',
}

const SYMBOL_NODE_TYPES = new Set([
  'function_declaration',
  'class_declaration',
  'interface_declaration',
  'type_alias_declaration',
  'lexical_declaration',
  'function_definition',
  'class_definition',
  'method_declaration',
  'type_declaration',
  'function_item',
  'struct_item',
  'enum_item',
  'trait_item',
  'impl_item',
])

let parserPromise: Promise<ParserInstance | null> | null = null
const languages = new Map<string, Language>()

function extensionOf(path: string): string {
  return /\.([a-z]+)$/i.exec(path)?.[1]?.toLowerCase() ?? ''
}

async function getParser(grammar: string): Promise<ParserInstance | null> {
  if (!parserPromise) {
    parserPromise = Parser.init()
      .then(() => new Parser())
      .catch(() => null)
  }
  const parser = await parserPromise
  if (!parser) return null

  let language = languages.get(grammar)
  if (!language) {
    try {
      const wasm = require.resolve(`tree-sitter-wasms/out/tree-sitter-${grammar}.wasm`)
      language = await Parser.Language.load(wasm)
      languages.set(grammar, language)
    } catch {
      return null
    }
  }
  parser.setLanguage(language)
  return parser
}

function nameOf(node: SyntaxNode): string | null {
  const direct = node.childForFieldName('name')
  if (direct?.text) return direct.text
  const declarator = node.children.find((child) => child.type === 'variable_declarator')
  const nested = declarator?.childForFieldName('name')
  if (nested?.text) return nested.text
  const identifier = node.children.find(
    (child: SyntaxNode) => child.type === 'identifier' || child.type === 'type_identifier',
  )
  return identifier?.text ?? null
}

/**
 * 用 tree-sitter（wasm）抽取顶层函数/类/类型。
 * 解析失败或语法不支持时返回 null，调用方会退回启发式切块。
 */
export async function splitWithTreeSitter(
  path: string,
  content: string,
): Promise<CodeSymbolPart[] | null> {
  const grammar = GRAMMAR_BY_EXTENSION[extensionOf(path)]
  if (!grammar) return null
  const parser = await getParser(grammar)
  if (!parser) return null

  try {
    const tree = parser.parse(content)
    const nodes: Array<{ symbol: string | null; start: number; end: number }> = []

    for (const child of tree.rootNode.children as SyntaxNode[]) {
      let target = child
      if (child.type === 'export_statement') {
        const declaration = child.childForFieldName('declaration')
        if (!declaration) continue
        target = declaration
      }
      if (!SYMBOL_NODE_TYPES.has(target.type)) continue
      nodes.push({ symbol: nameOf(target), start: child.startIndex, end: child.endIndex })
    }

    if (nodes.length === 0) return null

    const parts: CodeSymbolPart[] = []
    const preamble = content.slice(0, nodes[0]!.start).trim()
    if (preamble) parts.push({ symbol: null, content: preamble.slice(0, 2000) })
    for (const node of nodes) {
      const body = content.slice(node.start, node.end)
      for (const chunk of splitCodeChunks(body, 2000, 200)) {
        parts.push({ symbol: node.symbol, content: chunk })
      }
    }
    return parts
  } catch {
    return null
  }
}
