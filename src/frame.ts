import '@vitest/mocker/auto-register'
import { collectTests, getHooks } from '@vitest/runner'
import type { File as VitestFile } from '@vitest/runner'
import type { ParamSchemaEntry } from './runtime'

declare global {
  interface Window {
    __workshop_registry__: Array<{
      name: string
      fn: () => Promise<void> | void
      vignetviewName?: string
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

const params = new URLSearchParams(location.search)
const file = params.get('file')
const runParam = params.get('run')

// Populate __workshop_params__ from p.* query params. URL encoding: JSON.stringify + encodeURIComponent.
// URLSearchParams already decodes percent-encoding, so we just JSON.parse the value.
for (const [key, value] of params.entries()) {
  if (key.startsWith('p.')) {
    try {
      window.__workshop_params__[key.slice(2)] = JSON.parse(value)
    } catch {
      window.__workshop_params__[key.slice(2)] = value
    }
  }
}

if (!file) {
  throw new Error('Workshop frame: missing ?file= param')
}

// Minimal VitestRunner — just enough for collectTests to build the suite tree.
// All reporting hooks are optional and left unset.
const runner = {
  config: {
    root: '/',
    name: '',
    sequence: { shuffle: false, concurrent: false },
    setupFiles: [] as string[],
    allowOnly: false,
    retry: 0,
    diffOptions: {},
    testTimeout: 5000,
    hookTimeout: 5000,
  },
  pool: 'forks',
  viteEnvironment: { name: 'jsdom' },
  // trace wraps each collection step; we just run the callback directly.
  trace: (_name: string, _meta: object, fn: () => Promise<void>) => fn(),
  async importFile(filepath: string) {
    await import(/* @vite-ignore */ filepath)
  },
}

// Walk the collected suite tree depth-first and return the suite chain leading
// to the test at position `targetIndex` (matching __workshop_registry__ order).
function findSuitePath(tasks: VitestFile['tasks'], targetIndex: number): any[] {
  let count = 0
  function walk(tasks: any[]): any[] | null {
    for (const task of tasks) {
      if (task.type === 'test') {
        if (count++ === targetIndex) return []
      } else if (task.type === 'suite') {
        const result = walk(task.tasks)
        if (result !== null) return [task, ...result]
      }
    }
    return null
  }
  return walk(tasks) ?? []
}

;(async () => {
  // collectTests imports the file (via runner.importFile), which populates both
  // __workshop_registry__ and @vitest/runner's suite context with hooks.
  const [collectedFile] = await collectTests([file], runner as any)

  const all = window.__workshop_registry__.map((t, i) => ({ name: t.name, displayName: t.vignetviewName, index: i }))
  const hasViews = all.some(t => t.displayName !== undefined)
  const tests = hasViews ? all.filter(t => t.displayName !== undefined) : []
  window.parent.postMessage({ type: 'tests_collected', tests }, '*')

  if (runParam !== null && collectedFile) {
    const index = parseInt(runParam, 10)
    const entry = window.__workshop_registry__[index]

    if (entry && (!hasViews || entry.vignetviewName !== undefined)) {
      // Suites from outermost describe down to the test's immediate parent.
      const suites = findSuitePath(collectedFile.tasks, index)
      for (const s of suites) for (const h of getHooks(s).beforeAll) await (h as Function)()
      for (const s of suites) for (const h of getHooks(s).beforeEach) await (h as Function)()
      await entry.fn()
      for (const s of [...suites].reverse()) for (const h of getHooks(s).afterEach) await (h as Function)()
      for (const s of [...suites].reverse()) for (const h of getHooks(s).afterAll) await (h as Function)()

      // Send schema after full execution so both file-level and test-body param() calls are captured.
      window.parent.postMessage({ type: 'param_schema', schema: window.__workshop_param_schema__ }, '*')
    }
  }
})()
