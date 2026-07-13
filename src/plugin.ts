import type { Plugin, ViteDevServer } from 'vite'
import { glob, readFile } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'module'

// Resolve a vitest sub-package via vitest's own require context.
// pnpm doesn't hoist @vitest/* to the root node_modules, so we go through vitest.
// When vignet runs inside a consumer project, import.meta.url points to vignet's dist/
// and vitest is not in vignet's own node_modules (it's a peer dep), so the first attempt
// returns null. The fallback resolves vitest from process.cwd() (the consumer's project
// root) so aliases still point to the correct version vitest uses internally.
function resolveVitest(pkg: string): string | null {
  try {
    const localRequire = createRequire(import.meta.url)
    const vitestRequire = createRequire(localRequire.resolve('vitest'))
    return vitestRequire.resolve(pkg)
  } catch {
    try {
      const consumerRequire = createRequire(path.resolve(process.cwd(), 'package.json'))
      const vitestRequire = createRequire(consumerRequire.resolve('vitest'))
      return vitestRequire.resolve(pkg)
    } catch {
      return null
    }
  }
}
const VITEST_SPY_PATH = resolveVitest('@vitest/spy')
const VITEST_RUNNER_PATH = resolveVitest('@vitest/runner')
// The exports map routes '@vitest/mocker/auto-register' → dist/register.js (which only
// exports the function). We need dist/auto-register.js, which actually calls
// registerModuleMocker(() => new ModuleMockerServerInterceptor()). Derive it from the
// package index path to bypass the exports map.
const _VITEST_MOCKER_INDEX_PATH = resolveVitest('@vitest/mocker')
const VITEST_MOCKER_AUTO_REGISTER_PATH = _VITEST_MOCKER_INDEX_PATH
  ? path.join(path.dirname(_VITEST_MOCKER_INDEX_PATH), 'auto-register.js')
  : null
const VITEST_MOCKER_NODE_PATH = resolveVitest('@vitest/mocker/node')

const VIRTUAL_ID = 'virtual:workshop-vitest'
const RESOLVED_ID = '\0' + VIRTUAL_ID

// Used in static builds (workshopPlugin({ buildMode: true })). Captures hooks per-test at
// registration time so the pre-built bundle is self-contained: no @vitest/runner needed at runtime.
// describe() pushes/pops a hook frame; test() snapshots the full chain into the registry entry.
const VIRTUAL_VITEST_STATIC_SRC = `
import { fn, spyOn, restoreAllMocks, clearAllMocks, resetAllMocks, isMockFunction } from '@vitest/spy'

const noop = () => {}
const noopMatcher = new Proxy(noop, { get: () => noopMatcher, apply: () => noopMatcher })

const hookStack = [{ beforeAll: [], beforeEach: [], afterEach: [], afterAll: [] }]

export function describe(_name, fn) {
  hookStack.push({ beforeAll: [], beforeEach: [], afterEach: [], afterAll: [] })
  fn()
  hookStack.pop()
}

export const beforeEach = (fn) => { hookStack.at(-1).beforeEach.push(fn) }
export const afterEach  = (fn) => { hookStack.at(-1).afterEach.push(fn) }
export const beforeAll  = (fn) => { hookStack.at(-1).beforeAll.push(fn) }
export const afterAll   = (fn) => { hookStack.at(-1).afterAll.push(fn) }

export function test(name, optionsOrFn, fn) {
  const opts   = typeof optionsOrFn === 'object' && optionsOrFn !== null ? optionsOrFn : {}
  const testFn = typeof optionsOrFn === 'function' ? optionsOrFn : fn
  const hooks = {
    beforeAll:  hookStack.flatMap(s => s.beforeAll),
    beforeEach: hookStack.flatMap(s => s.beforeEach),
    afterEach:  [...hookStack].reverse().flatMap(s => s.afterEach),
    afterAll:   [...hookStack].reverse().flatMap(s => s.afterAll),
  }
  const entry = { name, fn: testFn, hooks }
  if (opts?.meta?.vignet?.name) entry.vignetviewName = opts.meta.vignet.name
  ;(window.__workshop_registry__ = window.__workshop_registry__ || []).push(entry)
}
export const it = test

export const expect = new Proxy(noop, {
  apply: () => noopMatcher,
  get(_, prop) {
    if (prop === 'extend' || prop === 'soft' || prop === 'poll') return noop
    return () => noopMatcher
  },
})

export const vi = {
  fn,
  spyOn,
  restoreAllMocks,
  clearAllMocks,
  resetAllMocks,
  isMockFunction,
  mocked: (f) => f,
  useFakeTimers: noop,
  useRealTimers: noop,
  setSystemTime: noop,
  runAllTimers: noop,
  runAllTimersAsync: noop,
  advanceTimersByTime: noop,
  advanceTimersByTimeAsync: noop,
  hoisted: (fn) => fn(),
  // In static builds vi.mock() calls are removed by buildMockPlugin; these are no-ops for safety.
  mock: noop,
  unmock: noop,
  doMock: noop,
  doUnmock: noop,
}

globalThis.vi = vi
`

// Served when any file does `import ... from 'vitest'` in the workshop Vite dev server.
// - test/it: push to __workshop_registry__ AND into @vitest/runner's suite context (for hooks)
// - describe/beforeEach/afterEach/beforeAll/afterAll: real @vitest/runner exports
// - expect: no-op proxy (assertions must not throw so components can render)
// - vi: real @vitest/spy so spyOn/fn/restoreAllMocks etc. work
const VIRTUAL_VITEST_SRC = `
import { fn, spyOn, restoreAllMocks, clearAllMocks, resetAllMocks, isMockFunction } from '@vitest/spy'
import { test as _test, it as _it, describe, beforeEach, afterEach, beforeAll, afterAll } from '@vitest/runner'
export { describe, beforeEach, afterEach, beforeAll, afterAll }

const noop = () => {}
const noopMatcher = new Proxy(noop, { get: () => noopMatcher, apply: () => noopMatcher })

export function test(name, optionsOrFn, fn) {
  const opts   = typeof optionsOrFn === 'object' && optionsOrFn !== null ? optionsOrFn : {}
  const testFn = typeof optionsOrFn === 'function' ? optionsOrFn : fn
  _test(name, testFn)
  const entry = { name, fn: testFn }
  if (opts?.meta?.vignet?.name) entry.vignetviewName = opts.meta.vignet.name
  ;(window.__workshop_registry__ = window.__workshop_registry__ || []).push(entry)
}
export const it = test

export const expect = new Proxy(noop, {
  apply: () => noopMatcher,
  get(_, prop) {
    if (prop === 'extend' || prop === 'soft' || prop === 'poll') return noop
    return () => noopMatcher
  },
})

export const vi = {
  fn,
  spyOn,
  restoreAllMocks,
  clearAllMocks,
  resetAllMocks,
  isMockFunction,
  mocked: (f) => f,
  // @sinonjs/fake-timers isn't resolvable through this project's pnpm tree
  useFakeTimers: noop,
  useRealTimers: noop,
  setSystemTime: noop,
  runAllTimers: noop,
  runAllTimersAsync: noop,
  advanceTimersByTime: noop,
  advanceTimersByTimeAsync: noop,
  // vi.hoisted runs its callback immediately (hoistMocksPlugin moves it before imports)
  hoisted: (fn) => fn(),
  // Delegate to @vitest/mocker's ModuleMocker (set up by @vitest/mocker/auto-register in frame.ts).
  // import.meta.url here is the shim's virtual URL; relative specifiers are rewritten to absolute
  // by workshopPlugin's transform before hoistMocksPlugin runs, so they resolve correctly.
  mock: (id, factory) => globalThis['__vitest_mocker__']?.queueMock(id, import.meta.url, factory),
  unmock: (id) => globalThis['__vitest_mocker__']?.queueUnmock(id, import.meta.url),
  doMock: (id, factory) => globalThis['__vitest_mocker__']?.queueMock(id, import.meta.url, factory),
  doUnmock: (id) => globalThis['__vitest_mocker__']?.queueUnmock(id, import.meta.url),
}

// hoistMocksPlugin moves vi.mock() calls to before the file's imports. At that hoisted
// position, vi hasn't been imported yet — so we expose it as a global here.
globalThis.vi = vi
`

// Returns only the hoist transform plugin from @vitest/mocker (used in build mode).
// The other mocker plugins require a running Vite server and are dev-mode only.
export async function getHoistMocksPlugin(): Promise<Plugin | null> {
  if (!VITEST_MOCKER_NODE_PATH) return null
  const mod = await import(VITEST_MOCKER_NODE_PATH) as { hoistMocksPlugin: () => Plugin }
  return mod.hoistMocksPlugin()
}

// Loads @vitest/mocker's Vite plugins (hoist transform, interceptor, automock, dynamic-import wrap).
// These use Vite's built-in server.ws WebSocket — no vitest orchestrator required.
// Returns an empty array if @vitest/mocker is not resolvable (e.g. vitest not installed).
export async function getMockerPlugins(): Promise<Plugin[]> {
  if (!VITEST_MOCKER_NODE_PATH) return []
  const mod = await import(VITEST_MOCKER_NODE_PATH) as { mockerPlugin: () => Plugin[] }
  const plugins = mod.mockerPlugin()
  // @vitest/mocker's ws-rpc load hook compares id === registerPath, but in a pnpm virtual store
  // the id Vite passes can differ from registerPath (symlink resolution, ?v=HASH query params,
  // /@fs/ prefix) so the comparison silently fails. The actual __VITEST_GLOBAL_THIS_ACCESSOR__
  // replacement is handled by workshopPlugin's transform hook (content-based, no path comparison).
  // This wrapper strips the query and /@fs prefix as a best-effort assist, but transform is the
  // reliable path.
  const wsRpc = plugins[0]
  const originalLoad = wsRpc.load
  ;(wsRpc as any).load = async function(this: unknown, id: string, ...args: unknown[]) {
    const fn = typeof originalLoad === 'function' ? originalLoad : (originalLoad as any)?.handler
    let cleanId = id.includes('?') ? id.slice(0, id.indexOf('?')) : id
    if (cleanId.startsWith('/@fs')) cleanId = cleanId.slice(4)
    return fn?.call(this, cleanId, ...args)
  }
  return plugins
}

// Discovers test files for the workshop — same glob + vignet: filter used in both dev and build modes.
export async function discoverWorkshopFiles(root: string, include: string | string[]): Promise<string[]> {
  const patterns = Array.isArray(include) ? include : [include]
  const files: string[] = []
  for (const pattern of patterns) {
    // Exclude node_modules explicitly: Yarn 1 installs file: dependencies as symlinks to
    // the entire source tree, so vignet's own example/ test files end up accessible under
    // node_modules/@vignet/workshop/ and would otherwise appear in the consumer's sidebar.
    // The package.json "files" field prevents this for npm/pnpm/Yarn Berry but not Yarn 1.
    for await (const f of glob(pattern, { cwd: root, exclude: (f) => f.includes('node_modules') })) {
      const content = await readFile(path.join(root, f), 'utf-8')
      if (content.includes('vignet:')) {
        files.push(path.join(root, f))
      }
    }
  }
  return files
}

interface WorkshopPluginOptions {
  include?: string | string[]
  buildMode?: boolean
}

export function workshopPlugin(options: WorkshopPluginOptions = {}): Plugin {
  const include = options.include ?? 'src/**/*.test.{ts,tsx}'
  const buildMode = options.buildMode ?? false
  let root: string

  return {
    name: 'workshop',
    enforce: 'pre',

    config() {
      // Alias pnpm-deduped @vitest/* packages to absolute paths so the virtual shim
      // and frame.ts can import them. pnpm doesn't hoist these to the root node_modules.
      const alias: Record<string, string> = {}
      if (VITEST_SPY_PATH) alias['@vitest/spy'] = VITEST_SPY_PATH
      if (VITEST_RUNNER_PATH) alias['@vitest/runner'] = VITEST_RUNNER_PATH
      if (VITEST_MOCKER_AUTO_REGISTER_PATH) alias['@vitest/mocker/auto-register'] = VITEST_MOCKER_AUTO_REGISTER_PATH
      return {
        // Prevent Vite from pre-bundling these; our resolveId hook intercepts vitest,
        // and the mocker packages live in the pnpm store, not root node_modules.
        optimizeDeps: { exclude: ['vitest', '@vitest/mocker/auto-register', '@vitest/mocker/register'] },
        ...(Object.keys(alias).length > 0 && { resolve: { alias } }),
      }
    },

    configResolved(config) {
      root = config.root
    },

    transform(code, id) {
      // @vitest/mocker's register.js ships with bare __VITEST_GLOBAL_THIS_ACCESSOR__ and
      // __VITEST_MOCKER_ROOT__ identifiers that must be replaced before the browser executes
      // the file. The ws-rpc load hook in @vitest/mocker does this via an id === registerPath
      // comparison, but that comparison fails in pnpm virtual stores due to symlink/path
      // differences. Content-based detection here is the reliable fallback.
      if (code.includes('__VITEST_GLOBAL_THIS_ACCESSOR__')) {
        return {
          code: code
            .replace(/__VITEST_GLOBAL_THIS_ACCESSOR__/g, '"__vitest_mocker__"')
            .replace('__VITEST_MOCKER_ROOT__', JSON.stringify(root)),
          map: null,
        }
      }
      // Rewrite relative vi.mock() IDs to project-root-absolute paths.
      // Runs before hoistMocksPlugin (enforce:'pre') so the absolute path is what gets hoisted.
      // This is needed because the shim's vi.mock passes import.meta.url (virtual URL) as the
      // importer, which makes relative paths unresolvable server-side.
      if (!code.includes('vi.mock(')) return null
      const dir = path.dirname(id)
      let changed = false
      const rewritten = code.replace(
        /\bvi\.mock\(\s*(['"`])(\.\.?\/[^'"`]+)\1/g,
        (full, _quote, relPath) => {
          const abs = '/' + path.relative(root, path.resolve(dir, relPath)).replaceAll(path.sep, '/')
          changed = true
          return full.replace(relPath, abs)
        },
      )
      return changed ? { code: rewritten, map: null } : null
    },

    resolveId(id) {
      if (id === 'vitest' || id === VIRTUAL_ID) return RESOLVED_ID
    },

    load(id) {
      if (id === RESOLVED_ID) return buildMode ? VIRTUAL_VITEST_STATIC_SRC : VIRTUAL_VITEST_SRC
    },

    configureServer(server: ViteDevServer) {
      if (buildMode) return
      server.middlewares.use('/__workshop_files__', async (_req, res) => {
        const discovered = await discoverWorkshopFiles(root, include)
        const files = discovered.map(f => '/' + path.relative(root, f).replaceAll(path.sep, '/'))
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ files }))
      })
    },
  }
}
