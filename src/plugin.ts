import type { Plugin, ViteDevServer } from 'vite'
import { glob } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'module'

// Resolve a vitest sub-package via vitest's own require context.
// pnpm doesn't hoist @vitest/* to the root node_modules, so we go through vitest.
function resolveVitest(pkg: string): string | null {
  try {
    const localRequire = createRequire(import.meta.url)
    const vitestRequire = createRequire(localRequire.resolve('vitest'))
    return vitestRequire.resolve(pkg)
  } catch {
    return null
  }
}
const VITEST_SPY_PATH = resolveVitest('@vitest/spy')
const VITEST_RUNNER_PATH = resolveVitest('@vitest/runner')

const VIRTUAL_ID = 'virtual:workshop-vitest'
const RESOLVED_ID = '\0' + VIRTUAL_ID

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

export function test(name, fn) {
  _test(name, fn)
  ;(window.__workshop_registry__ = window.__workshop_registry__ || []).push({ name, fn })
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
  // Module mocking requires vitest's hoist transform + server-side registry
  mock: noop,
  unmock: noop,
  doMock: noop,
  doUnmock: noop,
}
`

interface WorkshopPluginOptions {
  include?: string
}

export function workshopPlugin(options: WorkshopPluginOptions = {}): Plugin {
  const include = options.include ?? 'src/**/*.test.{ts,tsx}'
  let root: string

  return {
    name: 'workshop',
    enforce: 'pre',

    config() {
      // Alias pnpm-deduped @vitest/* packages to absolute paths so the virtual shim
      // can import them. pnpm doesn't hoist these to the root node_modules.
      const alias: Record<string, string> = {}
      if (VITEST_SPY_PATH) alias['@vitest/spy'] = VITEST_SPY_PATH
      if (VITEST_RUNNER_PATH) alias['@vitest/runner'] = VITEST_RUNNER_PATH
      return {
        // Prevent Vite from pre-bundling vitest so our resolveId hook intercepts it.
        optimizeDeps: { exclude: ['vitest'] },
        ...(Object.keys(alias).length > 0 && { resolve: { alias } }),
      }
    },

    configResolved(config) {
      root = config.root
    },

    resolveId(id) {
      if (id === 'vitest' || id === VIRTUAL_ID) return RESOLVED_ID
    },

    load(id) {
      if (id === RESOLVED_ID) return VIRTUAL_VITEST_SRC
    },

    configureServer(server: ViteDevServer) {
      server.middlewares.use('/__workshop_files__', async (_req, res) => {
        const files: string[] = []
        for await (const f of glob(include, { cwd: root })) {
          files.push('/' + f.replaceAll(path.sep, '/'))
        }
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ files }))
      })
    },
  }
}
