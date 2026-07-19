import '@vitest/mocker/auto-register'
import { collectTests, getHooks } from '@vitest/runner'
import type { File as VitestFile } from '@vitest/runner'
import type { ParamSchemaEntry } from './runtime'
import * as vitestShim from 'vitest'

// Installs the virtual vitest shim's exports (describe/it/test/expect/vi/hooks) onto
// globalThis, matching how real Vitest's `globals: true` behaves. Setup files and spec
// files that rely on implicit globals (no `import ... from 'vitest'`, e.g. Angular CLI's
// generated specs, or jest-dom's `expect.extend()` inside a consumer's setup file) would
// otherwise run before the shim is ever loaded, since it only installs on module import.
for (const [key, value] of Object.entries(vitestShim)) {
  ;(globalThis as any)[key] = value
}

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

// Surfaces failures both in this iframe's own devtools console (easy to miss — devtools
// defaults to the top frame's console context) and in the parent workshop UI, since a
// blank canvas otherwise gives the developer no indication anything went wrong.
function reportError(context: string, error: unknown) {
  const err = error instanceof Error ? error : new Error(String(error))
  console.error(`[vignet] ${context}:`, err)
  window.parent.postMessage(
    { type: 'workshop_error', context, message: err.message, stack: err.stack },
    '*',
  )
}

window.addEventListener('error', e => reportError('Uncaught error', e.error ?? e.message))
window.addEventListener('unhandledrejection', e => reportError('Unhandled rejection', e.reason))

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
  // Run the consumer's real setupFiles before collection, mirroring what Vitest's own
  // worker does. vitest.config.setupFiles is resolved server-side and served as /@fs/
  // URLs; import()ing them here (rather than just listing them in runner.config) is
  // required because @vitest/runner's collectTests never executes setupFiles itself.
  try {
    const { setupFiles } = await (await fetch('/__workshop_env__')).json()
    for (const url of setupFiles as string[]) {
      await import(/* @vite-ignore */ url)
    }
  } catch (error) {
    reportError('Failed to run setup files', error)
    return
  }

  // collectTests imports the file (via runner.importFile), which populates both
  // __workshop_registry__ and @vitest/runner's suite context with hooks. Import-time
  // failures (syntax errors, throwing top-level code) are caught internally by
  // collectTests and stored on file.result.errors rather than thrown — without checking
  // this, a broken test file just produces an empty variant list with no explanation.
  let collectedFile
  try {
    ;[collectedFile] = await collectTests([file], runner as any)
  } catch (error) {
    reportError(`Failed to collect tests from ${file}`, error)
    return
  }

  if (collectedFile?.result?.errors?.length) {
    for (const e of collectedFile.result.errors) {
      reportError(`Failed to load ${file}`, new Error(e.message ?? String(e)))
    }
    return
  }

  const all = window.__workshop_registry__.map((t, i) => ({ name: t.name, displayName: t.vignetviewName, index: i }))
  const hasViews = all.some(t => t.displayName !== undefined)
  const tests = hasViews ? all.filter(t => t.displayName !== undefined) : []
  window.parent.postMessage({ type: 'tests_collected', tests }, '*')

  if (runParam !== null && collectedFile) {
    const index = parseInt(runParam, 10)
    const entry = window.__workshop_registry__[index]

    if (entry && (!hasViews || entry.vignetviewName !== undefined)) {
      try {
        // Suites from outermost describe down to the test's immediate parent.
        const suites = findSuitePath(collectedFile.tasks, index)
        for (const s of suites) for (const h of getHooks(s).beforeAll) await (h as Function)()
        for (const s of suites) for (const h of getHooks(s).beforeEach) await (h as Function)()
        await entry.fn()
        for (const s of [...suites].reverse()) for (const h of getHooks(s).afterEach) await (h as Function)()
        for (const s of [...suites].reverse()) for (const h of getHooks(s).afterAll) await (h as Function)()
      } catch (error) {
        reportError(`Failed to render "${entry.vignetviewName ?? entry.name}"`, error)
        return
      }

      // Send schema after full execution so both file-level and test-body param() calls are captured.
      window.parent.postMessage({ type: 'param_schema', schema: window.__workshop_param_schema__ }, '*')
    }
  }
})()
