import type { Plugin, ViteDevServer } from 'vite'
import { glob } from 'node:fs/promises'
import path from 'node:path'

const VIRTUAL_ID = 'virtual:workshop-vitest'
const RESOLVED_ID = '\0' + VIRTUAL_ID

// Served when any file does `import ... from 'vitest'` in the workshop Vite dev server.
// test/it capture bodies into window.__workshop_registry__; expect is a no-op proxy.
const VIRTUAL_VITEST_SRC = `
const noop = () => {}
const noopMatcher = new Proxy({}, { get: () => noopMatcher })

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
export const vi = new Proxy({}, { get: () => noop })
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
