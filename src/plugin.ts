import type { Plugin, ViteDevServer } from 'vite'
import { glob } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'module'

// @vitest/spy is pure JS and browser-compatible. It's a dependency of vitest but
// pnpm doesn't hoist it to the root node_modules, so resolve it through vitest's context.
function resolveVitestSpyPath(): string | null {
  try {
    const localRequire = createRequire(import.meta.url)
    const vitestRequire = createRequire(localRequire.resolve('vitest'))
    return vitestRequire.resolve('@vitest/spy')
  } catch {
    return null
  }
}
const VITEST_SPY_PATH = resolveVitestSpyPath()

const VIRTUAL_ID = 'virtual:workshop-vitest'
const RESOLVED_ID = '\0' + VIRTUAL_ID

// Served when any file does `import ... from 'vitest'` in the workshop Vite dev server.
// test/it capture bodies into window.__workshop_registry__; expect is a no-op proxy.
// vi is real @vitest/spy so spyOn/fn/restoreAllMocks etc. work in workshop renders.
const VIRTUAL_VITEST_SRC = `
import { fn, spyOn, restoreAllMocks, clearAllMocks, resetAllMocks, isMockFunction } from '@vitest/spy'

const noop = () => {}
const noopMatcher = new Proxy(noop, { get: () => noopMatcher, apply: () => noopMatcher })

export function test(name, fn) {
  ;(window.__workshop_registry__ = window.__workshop_registry__ || []).push({ name, fn })
}
export const it = test

export function describe(_name, fn) { fn() }

export const expect = new Proxy(noop, {
  apply: () => noopMatcher,
  get(_, prop) {
    if (prop === 'extend' || prop === 'soft' || prop === 'poll') return noop
    return () => noopMatcher
  },
})

export const beforeEach = noop
export const afterEach = noop
export const beforeAll = noop
export const afterAll = noop

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
      return {
        // Prevent Vite from pre-bundling vitest so our resolveId hook intercepts it.
        optimizeDeps: { exclude: ['vitest'] },
        // Alias @vitest/spy to its absolute path so the virtual shim can import it.
        // pnpm doesn't hoist @vitest/spy to the root, so we resolve it at plugin load time.
        ...(VITEST_SPY_PATH && {
          resolve: { alias: { '@vitest/spy': VITEST_SPY_PATH } },
        }),
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
