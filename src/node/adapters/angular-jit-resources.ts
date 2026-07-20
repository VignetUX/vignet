import { createRequire } from 'node:module'
import path from 'node:path'
import type { Plugin } from 'vite'

// Angular CLI's real Vitest builder never resolves templateUrl/styleUrl at runtime — it
// rewrites @Component() decorators at compile time (see node_modules/@angular/build/src/
// tools/angular/transformers/jit-resource-transformer.js in a real Angular project), inlining
// the referenced files as `template`/`styles` before Vitest ever runs. That whole pipeline is
// explicitly marked private/unsupported outside @angular-devkit/build-angular and assumes a
// whole-program esbuild bundle, not Vite's per-file transform model — not something vignet's
// own dev server can just import.
//
// TestBed.compileComponents() does have a runtime fallback (resolveComponentResources()), but
// it requires injecting a ResourceLoader — an abstract class with no default provider anywhere
// in Angular, and no way to know the resolving file's directory from inside the resolver
// callback (it only receives the literal templateUrl string). Not usable standalone.
//
// Instead: reproduce the *effect* of Angular's compile-time transform ourselves, but lean on
// Vite's own built-in `?raw` (file contents as a string) and `?inline` (processed CSS as a
// string, not injected) import conventions instead of reimplementing file loading — this also
// gets Sass/PostCSS processing for free if the consumer has those Vite plugins configured.

function resolveTypescript(cwd: string): typeof import('typescript') | null {
  try {
    const consumerRequire = createRequire(path.resolve(cwd, 'package.json'))
    return consumerRequire(consumerRequire.resolve('typescript'))
  } catch {
    return null
  }
}

interface Edit {
  start: number
  end: number
  text: string
}

// Walks every @Component({...}) decorator in the file and rewrites templateUrl/styleUrl/
// styleUrls properties into template/styles properties backed by synthetic imports appended
// to the top of the file. Uses ts.canHaveDecorators/getDecorators (stable since TS 4.8) so
// both legacy and standard decorator syntax are handled the same way.
function transformSource(ts: typeof import('typescript'), code: string, id: string): string | null {
  const sourceFile = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const edits: Edit[] = []
  const imports: string[] = []
  let counter = 0

  function addResourceImport(relPath: string, suffix: '?raw' | '?inline'): string {
    const ident = `__vignet_res_${counter++}__`
    imports.push(`import ${ident} from ${JSON.stringify(relPath + suffix)}`)
    return ident
  }

  function visit(node: import('typescript').Node) {
    if (ts.isClassDeclaration(node) && ts.canHaveDecorators(node)) {
      for (const decorator of ts.getDecorators(node) ?? []) {
        const expr = decorator.expression
        if (!ts.isCallExpression(expr)) continue
        if (!ts.isIdentifier(expr.expression) || expr.expression.text !== 'Component') continue
        const arg = expr.arguments[0]
        if (!arg || !ts.isObjectLiteralExpression(arg)) continue

        for (const prop of arg.properties) {
          if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue
          const key = prop.name.text

          if (key === 'templateUrl' && ts.isStringLiteralLike(prop.initializer)) {
            const ident = addResourceImport(prop.initializer.text, '?raw')
            edits.push({ start: prop.getStart(sourceFile), end: prop.getEnd(), text: `template: ${ident}` })
          }

          if (key === 'styleUrl' && ts.isStringLiteralLike(prop.initializer)) {
            const ident = addResourceImport(prop.initializer.text, '?inline')
            edits.push({ start: prop.getStart(sourceFile), end: prop.getEnd(), text: `styles: [${ident}]` })
          }

          if (key === 'styleUrls' && ts.isArrayLiteralExpression(prop.initializer)) {
            const idents = prop.initializer.elements
              .filter(ts.isStringLiteralLike)
              .map(el => addResourceImport(el.text, '?inline'))
            if (idents.length > 0) {
              edits.push({ start: prop.getStart(sourceFile), end: prop.getEnd(), text: `styles: [${idents.join(', ')}]` })
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  if (edits.length === 0) return null

  edits.sort((a, b) => a.start - b.start)
  let result = ''
  let cursor = 0
  for (const edit of edits) {
    result += code.slice(cursor, edit.start) + edit.text
    cursor = edit.end
  }
  result += code.slice(cursor)

  return imports.join('\n') + '\n' + result
}

export function angularJitResourcePlugin(cwd: string): Plugin {
  const ts = resolveTypescript(cwd)

  return {
    name: 'vignet:angular-jit-resources',
    // Must run before Vite's esbuild TS transform strips/transpiles decorators, same reasoning
    // as workshopPlugin's own enforce: 'pre' in src/plugin.ts.
    enforce: 'pre',

    transform(code, id) {
      if (!ts) return null
      const cleanId = id.split('?')[0]
      if (!cleanId.endsWith('.ts') || cleanId.endsWith('.d.ts')) return null
      // Cheap bail before paying for a full parse.
      if (!code.includes('templateUrl') && !code.includes('styleUrl')) return null

      const result = transformSource(ts, code, id)
      return result ? { code: result, map: null } : null
    },
  }
}
