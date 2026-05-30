// Static frame runtime — loaded by frame.html in pre-built workshop output.
// Unlike frame.ts, this has no @vitest/mocker dependency: mocks are inlined into the bundle
// at build time. Hooks are captured per-test by the static vitest shim (VIRTUAL_VITEST_STATIC_SRC)
// and stored on each registry entry, so no @vitest/runner suite tree traversal is needed.

export {}

import type { ParamSchemaEntry } from './runtime'

declare global {
  interface Window {
    __workshop_registry__: Array<{
      name: string
      fn: () => Promise<void> | void
      jibeviewName?: string
      hooks?: {
        beforeAll: Array<() => Promise<void> | void>
        beforeEach: Array<() => Promise<void> | void>
        afterEach: Array<() => Promise<void> | void>
        afterAll: Array<() => Promise<void> | void>
      }
    }>
    __workshop_params__: Record<string, unknown>
    __workshop_param_schema__: ParamSchemaEntry[]
  }
}

window.__workshop_registry__ = []
window.__workshop_params__ = {}
window.__workshop_param_schema__ = []

// Params are passed via the URL hash (not query string) so they survive server-side
// clean-URL redirects (e.g. frame.html → frame). Browsers never include the hash in
// HTTP requests, so any redirect preserves it and reattaches it to the destination.
const params = new URLSearchParams(location.hash.slice(1))
const bundle = params.get('bundle')
const runParam = params.get('run')

// Populate __workshop_params__ from p.* hash params.
for (const [key, value] of params.entries()) {
  if (key.startsWith('p.')) {
    try {
      window.__workshop_params__[key.slice(2)] = JSON.parse(value)
    } catch {
      window.__workshop_params__[key.slice(2)] = value
    }
  }
}

if (!bundle) {
  throw new Error('Workshop frame: missing bundle param in URL hash')
}

;(async () => {
  // Import the pre-built test bundle. Its top-level code populates __workshop_registry__
  // with hook snapshots captured by the static vitest shim.
  await import(/* @vite-ignore */ `./tests/${bundle}`)

  const all = window.__workshop_registry__.map((t, i) => ({
    name: t.name,
    displayName: t.jibeviewName,
    index: i,
  }))
  const hasViews = all.some(t => t.displayName !== undefined)
  const tests = hasViews ? all.filter(t => t.displayName !== undefined) : []
  window.parent.postMessage({ type: 'tests_collected', tests }, '*')

  if (runParam !== null) {
    const index = parseInt(runParam, 10)
    const entry = window.__workshop_registry__[index]

    if (entry && (!hasViews || entry.jibeviewName !== undefined)) {
      const hooks = entry.hooks ?? { beforeAll: [], beforeEach: [], afterEach: [], afterAll: [] }
      for (const h of hooks.beforeAll) await h()
      for (const h of hooks.beforeEach) await h()
      await entry.fn()
      for (const h of hooks.afterEach) await h()
      for (const h of hooks.afterAll) await h()

      window.parent.postMessage({ type: 'param_schema', schema: window.__workshop_param_schema__ }, '*')
    }
  }
})()
