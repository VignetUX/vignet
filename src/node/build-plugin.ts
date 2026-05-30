import type { Plugin } from 'vite'
import path from 'node:path'

// Vite transform plugin for build mode: inlines vi.mock(id, factory) call sites so the bundled
// test file never imports the real module. Runs after hoistMocksPlugin (which moves vi.mock()
// calls before imports) and after workshopPlugin (which rewrites relative ids to root-relative).
//
// Plugin ordering in the build pipeline:
//   [workshopPlugin({ buildMode: true }), hoistMocksPlugin(), buildMockPlugin()]
// All three have enforce:'pre', so within the pre tier they run in array order.
export function buildMockPlugin(): Plugin {
  let root: string

  return {
    name: 'workshop-build-mock',
    enforce: 'pre',

    configResolved(config) {
      root = config.root
    },

    transform(code, id) {
      if (!/\.(test|spec)\.[tj]sx?$/.test(id)) return null
      if (!code.includes('vi.mock(')) return null

      const result = inlineMocks(code, id, root, this.warn.bind(this))
      return result
    },
  }
}

interface MockEntry {
  id: string       // root-relative path, e.g. /src/services/weatherService.ts
  factory: string  // factory expression source, e.g. () => ({ fn: vi.fn() })
  fullCall: string // the entire vi.mock(...) call, for removal from output
}

// Finds the index of the comma separating the id arg from the factory arg in vi.mock(id, factory).
// Skips nested parens/brackets/braces and string contents.
function findArgSplitComma(args: string): number {
  let depth = 0
  let i = 0
  // Skip leading whitespace
  while (i < args.length && ' \t\n'.includes(args[i])) i++
  // Skip the id string literal
  const q = args[i]
  if (q === '"' || q === "'" || q === '`') {
    i++
    while (i < args.length && args[i] !== q) {
      if (args[i] === '\\') i++
      i++
    }
    i++ // skip closing quote
  }
  // Find the top-level comma after the id
  while (i < args.length) {
    const ch = args[i]
    if (ch === '(' || ch === '{' || ch === '[') depth++
    else if (ch === ')' || ch === '}' || ch === ']') depth--
    else if (ch === ',' && depth === 0) return i
    i++
  }
  return -1
}

// Extracts the balanced-paren content starting at openPos (the '(' character).
function extractBalanced(code: string, openPos: number): { content: string; end: number } | null {
  let depth = 0
  let i = openPos
  while (i < code.length) {
    const ch = code[i]
    if (ch === '(' || ch === '{' || ch === '[') depth++
    else if (ch === ')' || ch === '}' || ch === ']') {
      depth--
      if (depth === 0) return { content: code.slice(openPos, i + 1), end: i + 1 }
    } else if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch
      i++
      while (i < code.length && code[i] !== q) {
        if (code[i] === '\\') i++
        i++
      }
    }
    i++
  }
  return null
}

function collectMocks(code: string, fileDir: string, root: string, warn: (msg: string) => void): MockEntry[] {
  const mocks: MockEntry[] = []
  const re = /vi\.mock\(/g
  let m: RegExpExecArray | null

  while ((m = re.exec(code)) !== null) {
    const openParenPos = m.index + 'vi.mock'.length
    const balanced = extractBalanced(code, openParenPos)
    if (!balanced) continue

    const argsContent = balanced.content.slice(1, -1)
    const fullCall = 'vi.mock' + balanced.content

    // Extract the id string (first argument)
    const idMatch = argsContent.match(/^\s*(['"`])(.*?)\1/)
    if (!idMatch) continue
    const rawId = idMatch[2]

    // Resolve to root-relative path (workshopPlugin already rewrites relative paths)
    let resolvedId: string
    if (rawId.startsWith('/')) {
      resolvedId = rawId
    } else if (rawId.startsWith('.')) {
      resolvedId = '/' + path.relative(root, path.resolve(fileDir, rawId)).replaceAll(path.sep, '/')
    } else {
      continue // bare specifier like 'react' — not a file mock we handle
    }

    // Check for factory argument
    const commaIdx = findArgSplitComma(argsContent)
    if (commaIdx === -1) {
      warn(`[jibe] Auto-mock not supported in static builds: vi.mock('${rawId}') — real module will be bundled.`)
      continue
    }
    const factory = argsContent.slice(commaIdx + 1).trim()
    mocks.push({ id: resolvedId, factory, fullCall })
  }

  return mocks
}

function inlineMocks(
  code: string,
  id: string,
  root: string,
  warn: (msg: string) => void,
): { code: string; map: null } | null {
  const fileDir = path.dirname(id)
  const mocks = collectMocks(code, fileDir, root, warn)
  if (mocks.length === 0) return null

  const mockMap = new Map(mocks.map(m => [m.id, m]))
  let result = code
  let mockCounter = 0

  // Rewrite each import statement that matches a mocked module
  const importRe = /^import\s+(.*?)\s+from\s+(['"`])(.*?)\2\s*;?/gm
  let match: RegExpExecArray | null

  while ((match = importRe.exec(code)) !== null) {
    const importClause = match[1].trim()
    const rawSpec = match[3]

    // Skip type-only imports
    if (/^type\s/.test(importClause)) continue

    // Resolve import specifier to root-relative path
    let resolvedSpec: string
    if (rawSpec.startsWith('/')) {
      resolvedSpec = rawSpec
    } else if (rawSpec.startsWith('.')) {
      resolvedSpec = '/' + path.relative(root, path.resolve(fileDir, rawSpec)).replaceAll(path.sep, '/')
    } else {
      continue
    }

    const mock = mockMap.get(resolvedSpec)
    if (!mock) continue

    const varName = `__mock_${mockCounter++}__`
    const factoryCall = `const ${varName} = (${mock.factory})()`
    let binding: string

    if (importClause.startsWith('* as ')) {
      // import * as ns from '...'
      const ns = importClause.slice(5).trim()
      binding = `const ${ns} = ${varName}`
    } else if (importClause.startsWith('{')) {
      // import { x, y as z } from '...'
      binding = `const ${importClause} = ${varName}`
    } else if (importClause.includes(',')) {
      // import foo, { x } from '...' — default + named
      const commaIdx = importClause.indexOf(',')
      const defaultPart = importClause.slice(0, commaIdx).trim()
      const namedPart = importClause.slice(commaIdx + 1).trim()
      binding = `const ${defaultPart} = ${varName}.default ?? ${varName}\nconst ${namedPart} = ${varName}`
    } else {
      // import foo from '...' — default only
      binding = `const ${importClause} = ${varName}.default ?? ${varName}`
    }

    result = result.replace(match[0], `${factoryCall}\n${binding}`)
  }

  // Remove all collected vi.mock() factory calls (already inlined or dead mocks for
  // modules not imported directly — removing them avoids calling the no-op mock runtime)
  for (const mock of mocks) {
    result = result.replace(mock.fullCall, '')
  }

  return { code: result, map: null }
}
