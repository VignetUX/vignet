# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **Storybook-style component workshop** for React components. The core idea: existing Vitest test files double as workshop stories. The workshop renders one test variant at a time in an iframe, with assertions silently skipped. Developers get component previews without writing separate story files.

## Architecture

**Chosen approach: Vite dev server that interfaces with a vitest instance/server.** Vitest browser mode was tried first (iter 1) but rejected because:

- Vitest has no concept of "render phase" vs "assertion phase" — you'd be fighting its batch-oriented runner
- Parameter injection has no natural hook point in Vitest's execution model
- The orchestrator RPC/WebSocket layer is unstable internal API that breaks across Vitest versions

The current approach uses vitest's Vite server for transforms (JSX/TS resolution) and `@vitest/runner` + `@vitest/spy` + `@vitest/mocker` for in-browser test lifecycle, mock/spy support, and module mocking. The vitest orchestrator (RPC/WebSocket layer) is not used.

### How it works

```text
Workshop UI  (src/ui/App.tsx, served via src/node/server.ts)
  hosts an <iframe>
    ↓  iframe.src = /frame?file=/src/Button.test.tsx&run=0
iframe  (src/frame.ts, served at /frame by src/node/server.ts)
  sets window.__workshop_registry__ = []
  calls collectTests([file], runner) from @vitest/runner
    ↓  runner.importFile triggers: import { test, expect } from 'vitest'  →  virtual shim
  test bodies are captured into __workshop_registry__; hooks registered in @vitest/runner's suite tree
  postMessages test list to parent UI
  if ?run=N:
    walks suite tree to find hooks for the selected test
    runs beforeAll → beforeEach → registry[N].fn() → afterEach → afterAll
    component renders in real DOM
```

**Key interception mechanism:** The Vite plugin (`src/plugin.ts`) intercepts `import ... from 'vitest'` and replaces it with a virtual module. `test`/`it` push closures into `window.__workshop_registry__` (for the workshop UI) and also register with `@vitest/runner`'s suite context (for hook scoping). `expect` is a full no-op Proxy so assertions never throw. Test files require zero modification.

**Real spy/mock support:** The virtual shim imports `vi.spyOn`, `vi.fn`, `vi.restoreAllMocks`, etc. from `@vitest/spy` — the same library vitest uses internally. Mocks set up in test bodies work correctly in workshop renders.

**Real module mocking:** `vi.mock()` / `vi.unmock()` / `vi.doMock()` / `vi.doUnmock()` are delegated to `@vitest/mocker`, a standalone package that ships with vitest. `@vitest/mocker` communicates over Vite's built-in HMR WebSocket (`server.ws`) — it has no dependency on vitest's orchestrator or birpc. Both auto-mocks (`vi.mock('id')`) and factory mocks (`vi.mock('id', factory)`) work. See `docs/module-mocking.md` for architecture details.

**Real lifecycle hooks:** `beforeEach`/`afterEach`/`beforeAll`/`afterAll` are re-exported directly from `@vitest/runner`. `describe` is also from `@vitest/runner`, so hook scoping by describe block is correct. `frame.ts` uses `collectTests` to build the suite tree, then `getHooks(suite)` to run the right hooks before/after each variant.

**Clean state between variants:** Selecting a different test sets `iframe.src` to a new URL, triggering a full iframe reload. No manual React cleanup needed.

**Communication:** Parent ↔ iframe uses `postMessage` only. No WebSocket, no birpc, no Vitest RPC.

### Key files

| File | Purpose |
| --- | --- |
| `src/cli/cli.ts` | CLI entry — calls `createVitest('test', {watch:true})` then `startJibeServer(vitest)` |
| `src/node/server.ts` | Standalone Vite server: serves workshop UI + frame endpoint, opens browser |
| `src/frame.ts` | Iframe runtime — uses `collectTests` to import test file and build suite tree; runs hooks + selected variant |
| `src/ui/App.tsx` | React workshop UI — iframe host + variant trigger button |
| `src/ui/main.tsx` | React entry point — mounts `App` into `#root` |
| `src/plugin.ts` | Vite plugin: virtual `vitest` shim, `@vitest/spy`/`@vitest/runner`/`@vitest/mocker` aliases, `/__workshop_files__` endpoint, `getMockerPlugins()` |
| `src/runtime.ts` | `param(key, default)` helper for future parameterized inputs |
| `src/index.ts` | Package entry — re-exports `param` |
| `example/frontend/src/Button.tsx` | Example consumer component |
| `example/frontend/src/Button.test.tsx` | Example test file — unmodified standard Vitest tests |
| `example/frontend/src/components/ProfileFormPage.tsx` | Example form component with fetch + loading state |
| `example/frontend/src/components/ProfileFormPage.test.tsx` | Example tests using spies, mocks, and lifecycle hooks |
| `example/frontend/src/components/WeatherWidget.tsx` | Example component that uses a module-level service dependency |
| `example/frontend/src/components/WeatherWidget.test.tsx` | Example tests using `vi.mock()` for module mocking — the primary fixture for verifying mock support |
| `example/frontend/vitest.config.ts` | Standard jsdom Vitest config for `npm test` |
| `docs/module-mocking.md` | Architecture doc for `vi.mock()` support — implementation approach, gotchas, what works |

### Jibe CLI server (`src/node/server.ts`)

`jibe` is a **standalone CLI**, not a consumer-facing Vite plugin. Like Vitest, it creates its own Vite server via `createServer()` with `configFile: false` (consumer's `vite.config.ts` is intentionally ignored). Consumers never touch their Vite config.

`startJibeServer()` uses an internal plugin to register its HTTP middleware. This plugin wrapper is required for correct middleware ordering: by the time `createServer()` returns, Vite has already registered its internal middleware (including the SPA HTML fallback). A plugin's `configureServer` hook runs *before* that registration, so jibe's middleware intercepts `/` first. This is the same pattern Vitest uses in `packages/browser/src/node/plugin.ts`.

The middleware serves an HTML shell that loads `src/ui/main.tsx` via `/@fs/<absolute-path>`. Vite's `/@fs/` escape hatch serves files outside `root` when listed in `server.fs.allow`. The HTML is passed through `server.transformIndexHtml('/', html)` before being sent — this injects the `@vitejs/plugin-react` Fast Refresh preamble. Without it, React Fast Refresh throws "can't detect preamble". This matches Vitest's tester middleware pattern (`serverTester.ts` calls `vite.transformIndexHtml(url, testerHtml)`); the difference is we pass `'/'` as the URL since our HTML is generated in-memory rather than read from a file.

### Plugin internals

`workshopPlugin()` in `src/plugin.ts` handles iframe test loading and the vitest shim:

- `enforce: 'pre'` — runs before other plugins so the `vitest` alias wins and relative `vi.mock()` paths are rewritten before `hoistMocksPlugin` runs
- `resolveVitest(pkg)` — resolves pnpm-deduped `@vitest/*` packages via vitest's own require context, since pnpm doesn't hoist them to the root `node_modules`
- `config()` hook returns aliases for `@vitest/spy`, `@vitest/runner`, and `@vitest/mocker/auto-register` (the last points directly to `dist/auto-register.js`, bypassing the package exports map which routes to the wrong file), plus `optimizeDeps: { exclude: [...] }` to prevent pre-bundling
- `transform()` hook rewrites relative `vi.mock('./path')` specifiers to project-root-absolute paths before the hoist transform runs, so the shim can resolve them server-side
- `resolveId('vitest')` → returns `'\0virtual:workshop-vitest'`
- `load('\0virtual:workshop-vitest')` → returns the shim source
- `configureServer` middleware at `/__workshop_files__` — globs for files matching the `include` pattern and returns JSON `{ files: string[] }`

`getMockerPlugins()` in `src/plugin.ts` loads `mockerPlugin()` from `@vitest/mocker/node` and returns it for use in the Vite server config. It also wraps the ws-rpc plugin's `load` hook to strip `?v=HASH` cache-busting query params before the path comparison (a bug in `@vitest/mocker` that prevents it from intercepting `register.js` in a plain Vite server).

### Virtual vitest shim

The shim is the string constant `VIRTUAL_VITEST_SRC` in `src/plugin.ts`. What each export does:

| Export | Source | Behavior |
| --- | --- | --- |
| `test` / `it` | custom | Calls `@vitest/runner`'s `_test` (for suite context) AND pushes to `__workshop_registry__` (for UI) |
| `describe` | `@vitest/runner` | Real — manages suite context stack for correct hook scoping |
| `beforeEach` / `afterEach` / `beforeAll` / `afterAll` | `@vitest/runner` | Real — registers hooks on the current suite; `frame.ts` runs them via `getHooks()` |
| `expect` | custom no-op Proxy | Returns a proxy for any chain; never throws — assertions are silently skipped |
| `vi.spyOn` / `vi.fn` / `vi.restoreAllMocks` etc. | `@vitest/spy` | Real — mocks and spies work correctly in workshop renders |
| `vi.useFakeTimers` etc. | no-op | `@sinonjs/fake-timers` not accessible through this pnpm tree |
| `vi.mock` / `vi.unmock` / `vi.doMock` / `vi.doUnmock` | `@vitest/mocker` | Real — delegated to `@vitest/mocker`; see `docs/module-mocking.md` |

The shim also sets `globalThis.vi = vi` so that `vi.mock()` calls hoisted before imports (by `hoistMocksPlugin`) can reference `vi` before the `import { vi } from 'vitest'` statement has run.

### Frame runtime (`src/frame.ts`)

The iframe runtime uses `collectTests` from `@vitest/runner` with a minimal runner implementation:

```js
minimalRunner = {
  config: { root, name, sequence, setupFiles: [], testTimeout, hookTimeout, ... }
  importFile(filepath) → await import(filepath)   // triggers test registration
  trace(_name, _meta, fn) → fn()                  // no-op tracing
}
```

The first line of `frame.ts` is `import '@vitest/mocker/auto-register'`, which sets `globalThis.__vitest_mocker__` via `registerModuleMocker(() => new ModuleMockerServerInterceptor())` before any test collection. This ensures mock registrations are in place when `runner.importFile` triggers the test file's static imports.

After `collectTests`:

- `window.__workshop_registry__` has the flat test list (for the UI)
- `@vitest/runner`'s internal suite tree has the hook associations

`findSuitePath(collectedFile.tasks, index)` walks the suite tree depth-first to find the suite chain (root → ... → immediate parent) for the test at the given index. `getHooks(suite)` is called on each suite in the chain to run hooks in the correct describe-scoped order.

### `param()` for future prop knobs

Test files can import `param` from `@jibe/workshop/runtime`:

```ts
import { param } from '@jibe/workshop/runtime'

test('primary', () => {
  const label = param('label', 'Click me')  // reads from controls in workshop, default in test mode
  render(<Button label={label} />)
  expect(screen.getByRole('button', { name: label })).toBeTruthy()
})
```

In workshop mode: `param()` reads from `window.__workshop_params__` (set by future controls UI). In `npm test` mode: returns the default value (real `vitest` is used; `param` just returns defaults).

## Running

```bash
# In the root package — rebuild the CLI after changes to src/
npm run build

# In example/frontend/ — start the jibe workshop server
cd example/frontend && npm run jibe   # opens http://localhost:5173/

# In example/frontend/ — run standard Vitest tests (real assertions, jsdom)
cd example/frontend && npm test
```

## Planned Directory Structure

Inferred from `.gitignore` entries:

- `test/fixtures/` — fixture projects for integration tests; each has its own `node_modules/`, `jibe-dist/`, and `workshop-dist/` (all gitignored)
