# Param Controls — Design

Interactive parameter controls that let users modify inputs in the workshop UI and see component re-renders. Unlike Storybook's Controls addon (which restricts controls to component props), vignet params work for anything in a test body: props, mock return values, feature flag states, network delays, etc.

---

## Current State

`src/runtime.ts` exports a stub `param()`:

```ts
export function param<T>(key: string, defaultValue: T): T {
  const p = (window as any).__workshop_params__
  return p && key in p ? p[key] : defaultValue
}
```

`frame.ts` initializes `window.__workshop_params__ = {}` at startup but nothing ever populates it. There is no controls UI. The message protocol is one-way (iframe → parent: `tests_collected` only).

---

## API

Extend the existing `param(key, default)` with an optional third argument for control metadata. The function name stays `param`.

```ts
import { param } from '@vignet/workshop/runtime'

// text input (inferred from string default)
const label = param('label', 'Click me')

// number input
const count = param('count', 0)

// range slider
const opacity = param('opacity', 1, { min: 0, max: 1, step: 0.01 })

// select dropdown
const variant = param('variant', 'primary', { options: ['primary', 'secondary', 'danger'] })

// checkbox
const enabled = param('enabled', true)

// JSON textarea (object or array default → JSON editor)
const user = param('user', { name: 'Alice', role: 'admin' })
```

Control type is inferred from the default value's JS type plus the presence of `options` or `min`/`max`:

| Default value type      | `opts`                | Inferred control |
|-------------------------|-----------------------|-----------------|
| `string`                | —                     | text input      |
| `number`                | —                     | number input    |
| `number`                | `min` and/or `max`    | range slider    |
| `boolean`               | —                     | checkbox/toggle |
| any                     | `options: [...]`      | select dropdown |
| `object` or `array`     | —                     | JSON textarea   |

**`opts` type:**
```ts
interface ParamOptions {
  label?: string           // display name in controls panel (defaults to key)
  options?: unknown[]      // forces select dropdown; values must be JSON-serializable
  min?: number
  max?: number
  step?: number
}
```

In real Vitest (`npm test`): `param` is imported from the actual `@vignet/workshop/runtime` file with no workshop globals. It must return `defaultValue` unconditionally:

```ts
export function param<T>(key: string, defaultValue: T, _opts?: ParamOptions): T {
  const p = typeof window !== 'undefined' && (window as any).__workshop_params__
  return p && key in p ? (p[key] as T) : defaultValue
}
```

---

## Mock return value example (the key differentiator from Storybook)

`param()` works anywhere in the test body — including inside mock implementations:

```ts
import { param } from '@vignet/workshop/runtime'

it('profile form — configurable network state', { meta: { vignet: { name: 'Network states' } } }, async () => {
  const status  = param('status',  200,  { options: [200, 401, 500] })
  const latency = param('latency', 0,    { min: 0, max: 3000, step: 100 })

  vi.mocked(fetchUser).mockImplementation(() =>
    new Promise((resolve, reject) =>
      setTimeout(
        () => status === 200 ? resolve(mockUser) : reject(new Error('HTTP ' + status)),
        latency
      )
    )
  )

  render(<ProfileFormPage />)
})
```

Changing `status` to `500` immediately shows the error state. Changing `latency` to `1500` shows the loading spinner for 1.5 s. This works because the full test body (including mock setup) re-runs on every param change.

---

## Architecture: URL-encoded params

**Chosen approach.** On every param change, the UI navigates the iframe to a new URL with params encoded as query params (`?p.label=Click+me&p.count=5`). The iframe reloads and reads params from the URL before running the test.

### Execution order in `frame.ts`

```
1. Parse URL → __workshop_params__
   __workshop_param_schema__ = []    ← new global; cleared per load

2. collectTests([file], runner)
   └── runner.importFile → await import(filepath)
       └── module top-level code runs:
           ├── file-level param() calls → register schema + read URL value
           └── it()/test() bodies captured as closures (NOT called yet)

3. postMessage({ type: 'tests_collected', tests })

4. if ?run=N:
   ├── beforeAll/beforeEach hooks
   ├── entry.fn()
   │   └── test-body param() calls → register schema + read URL value
   └── afterEach/afterAll hooks

5. postMessage({ type: 'param_schema', schema: __workshop_param_schema__ })
   ↑ sent AFTER entry.fn() — captures both file-level AND test-body param schemas
```

URL parsing happens before everything, so both file-level `const label = param(...)` and test-body `const label = param(...)` read fresh values from the URL on every reload. No dry-run pass is needed.

### File-level vs. test-body params

Both work with this approach:

```ts
// file-level — runs at import time during collectTests
const theme = param('theme', 'light', { options: ['light', 'dark'] })

it('button', { meta: { vignet: { name: 'Primary' } } }, () => {
  // test-body — runs when entry.fn() executes
  const label = param('label', 'Click me')
  render(<ThemeProvider theme={theme}><Button label={label} /></ThemeProvider>)
})
```

Both `theme` and `label` are included in the `param_schema` message and shown as controls in the UI for this view. On param change, the full iframe reloads; both params are re-read from the URL.

### Per-view isolation

The iframe fully reloads on every view switch (`?run=N` changes). Each reload clears `__workshop_param_schema__` and rebuilds it. The URL carries no params from other views. A file-level param used by multiple views is independently controlled per view:

```
view 0: ?run=0&p.theme=dark
view 1: ?run=1&p.theme=light   ← independent; no cross-view bleed
```

### Message protocol additions

```
iframe → parent:  { type: 'param_schema',
                    schema: Array<{
                      key: string
                      label: string           // display name
                      defaultValue: unknown
                      control: 'text' | 'number' | 'range' | 'boolean' | 'select' | 'json'
                      options?: unknown[]
                      min?: number
                      max?: number
                      step?: number
                    }>
                  }

parent → iframe:  (none — param changes trigger iframe.src navigation)
```

### Build mode

`frame-static.ts` uses `location.hash` (`#bundle=Button&run=0`). Params extend the hash:

```
#bundle=Button&run=0&p.label=Click+me&p.count=5
```

The hash parser in `frame-static.ts` needs to handle `p.*` keys alongside `bundle` and `run`.

### URL encoding

- Primitives (string, number, boolean): `String(value)`, decoded as `Number()`/`=== 'true'` by type
- Objects/arrays (JSON textarea): `JSON.stringify(value)` + `encodeURIComponent`; decoded with `JSON.parse(decodeURIComponent(...))`

---

## Open questions

1. **Async edge case:** `param()` inside a non-awaited callback (e.g., `setTimeout` that fires after `entry.fn()` resolves) will not appear in the schema because step 5 has already run. Known limitation for v1 — document it and move on. Most real test patterns await everything.

2. **JSON encoding length:** `JSON.stringify` + `encodeURIComponent` for complex objects can produce very long URLs. If this becomes a problem, switch to `btoa(JSON.stringify(...))`. Starting with the readable form is better for debugging.

3. **Build mode hash parser:** Confirm `frame-static.ts`'s hash parsing handles `&p.*` entries without conflicting with `bundle` and `run`. The simplest implementation: `new URLSearchParams(location.hash.slice(1))` works for all of these.

4. **JSON textarea validation:** When the user types invalid JSON in a control, show a validation error inline and do not navigate. The URL is only updated when `JSON.parse` succeeds.

---

## Appendix: alternative architectures considered

### Approach B — postMessage real-time (no reload)

Params flow as `update_params` postMessages. `frame.ts` listens and re-runs `beforeEach → fn → afterEach` in-place. True real-time feel with no reload flash.

Rejected for v1 because:
- Requires build mode to also have a live iframe (incompatible with pre-rendered static bundles)
- More complex frame.ts: must manage in-place re-run state, React cleanup, etc.
- Not needed once iframe reload is fast enough (Vite HMR + no full page reload = sub-100ms)

### Approach C — Hybrid URL + postMessage

URL for initial load and shareable links; postMessage for live updates after first render.

Best long-term architecture, but adds complexity in two places simultaneously. Deferred until Approach A is validated and build mode requirements are clearer.
