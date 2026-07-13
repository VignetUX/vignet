# Module mocking in the Vignet workshop

## Status: implemented via `@vitest/mocker`

`vi.mock()`, `vi.unmock()`, `vi.doMock()`, and `vi.doUnmock()` are fully supported, including
both auto-mocks (`vi.mock('id')`) and factory mocks (`vi.mock('id', () => ...)`).

---

## Architecture

Vignet delegates the entire mock infrastructure to `@vitest/mocker`, a standalone package that
ships with vitest. `@vitest/mocker` communicates over **Vite's built-in HMR WebSocket**
(`import.meta.hot` client-side, `server.ws` server-side) — it has no dependency on vitest's
orchestrator, birpc, or any other vitest-specific RPC layer.

The original feasibility doc incorrectly stated that `ModuleMockerServerInterceptor` "requires
the vitest birpc bridge." That was wrong: inspection of `@vitest/mocker/dist/node.js` and the
interceptor chunk shows only standard `hot.send`/`hot.on` calls. The `mockerPlugin()` export
even includes the source comment: *"this is an implementation for public usage — vitest doesn't
use this plugin directly."*

---

## What `@vitest/mocker` provides

| Component | What it does |
|---|---|
| `hoistMocksPlugin` | Vite `transform` — AST-hoists `vi.mock()` calls before import statements, converts static imports to dynamic |
| `interceptorPlugin` | Registers `server.ws.on("vitest:interceptor:*")` handlers; maintains `MockerRegistry`; serves mocked modules |
| `automockPlugin` | Vite `transform` — stubs exports when URL has `?mock=automock` |
| `dynamicImportPlugin` | Wraps `import()` calls with `globalThis.__vitest_mocker__.wrapDynamicImport` |
| `auto-register.js` | Side-effect import — calls `registerModuleMocker(() => new ModuleMockerServerInterceptor())`, sets `globalThis.__vitest_mocker__` |

`mockerPlugin()` from `@vitest/mocker/node` returns all five as a plugin array.

---

## Implementation

### `src/plugin.ts`

- `getMockerPlugins()` calls `mockerPlugin()` and returns the plugin array to be spread into
  Vite's plugin config.
- The `@vitest/mocker/auto-register` alias is pointed at `dist/auto-register.js` directly
  (bypassing the package exports map, which incorrectly routes `./auto-register` to
  `dist/register.js` — a file that only exports `registerModuleMocker` but never calls it).
- The ws-rpc plugin's `load` hook is wrapped to strip `?v=HASH` query params before comparing
  against `registerPath`. Vite passes module IDs with cache-busting query params; `mockerPlugin`
  does a strict equality check that fails without this strip.
- A `transform` hook (enforce:'pre') rewrites relative `vi.mock()` paths to project-root-absolute
  before `hoistMocksPlugin` runs. Relative paths would be unresolvable server-side because the
  shim's `import.meta.url` is a virtual URL.
- The virtual vitest shim sets `globalThis.vi = vi` so that hoisted `vi.mock()` calls can
  reference `vi` before the `import { vi } from 'vitest'` has executed.

### `src/frame.ts`

- `import '@vitest/mocker/auto-register'` is the first line. This sets
  `globalThis.__vitest_mocker__` before any test collection, so mocks are in place when
  `runner.importFile` triggers the test file's static imports.

### `src/node/server.ts`

- The main window HTML injects a passthrough `__vitest_mocker__` stub before the module script
  so that `dynamicImportPlugin`'s `wrapDynamicImport` calls don't crash in the UI frame (which
  has no real mocker active).

---

## What works

| Pattern | Status |
|---|---|
| `vi.mock('npm-package')` — auto-mock | Works |
| `vi.mock('npm-package', factory)` — factory mock | Works |
| `vi.mock('./relative/path')` — relative path | Works (rewritten to absolute by the pre-transform) |
| `vi.unmock`, `vi.doMock`, `vi.doUnmock` | Works |
| `vi.mocked(fn).mockReturnValue(...)` etc. | Works (via `@vitest/spy`) |

## What still won't work

`vi.mock` with a factory that uses `vi.importActual()` internally — this requires a server-side
round-trip that the current WebSocket bridge does support in theory, but hasn't been exercised.
