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

**Key interception mechanism:** The Vite plugin (`src/plugin.ts`) intercepts `import ... from 'vitest'` and replaces it with a virtual module. `test`/`it` push closures into `window.__workshop_registry__` (for the workshop UI) and also register with `@vitest/runner`'s suite context (for hook scoping). `expect` is a full no-op Proxy so assertions never throw. Tests are marked as workshop views by passing `{ meta: { vignet: { name: 'View Name' } } }` as the options argument to `it`/`test`; files with no such calls are excluded from the workshop entirely.

**Real spy/mock support:** The virtual shim imports `vi.spyOn`, `vi.fn`, `vi.restoreAllMocks`, etc. from `@vitest/spy` — the same library vitest uses internally. Mocks set up in test bodies work correctly in workshop renders.

**Real module mocking:** `vi.mock()` / `vi.unmock()` / `vi.doMock()` / `vi.doUnmock()` are delegated to `@vitest/mocker`, a standalone package that ships with vitest. `@vitest/mocker` communicates over Vite's built-in HMR WebSocket (`server.ws`) — it has no dependency on vitest's orchestrator or birpc. Both auto-mocks (`vi.mock('id')`) and factory mocks (`vi.mock('id', factory)`) work. See `docs/module-mocking.md` for architecture details.

**Real lifecycle hooks:** `beforeEach`/`afterEach`/`beforeAll`/`afterAll` are re-exported directly from `@vitest/runner`. `describe` is also from `@vitest/runner`, so hook scoping by describe block is correct. `frame.ts` uses `collectTests` to build the suite tree, then `getHooks(suite)` to run the right hooks before/after each variant.

**Lazy test execution:** `collectTests` imports the test file and registers all test bodies as closures in `__workshop_registry__`, but does not call any of them. Only `registry[N].fn()` — the single selected variant — is ever executed per iframe load. All other test bodies remain dormant. When a file is first selected, `App.tsx` sets `?run=0`, so the first variant renders immediately without requiring an explicit click. `frame.ts` only forwards entries tagged with `vignetviewName` to the parent UI; `?run=N` is also guarded so it only executes if the target entry carries a `vignetviewName`.

**Test-environment bootstrapping (setupFiles) — Tier 1, generic:** `vitest.config.setupFiles` is the fully-resolved, absolute-path list Vitest itself would import before running tests. `src/node/server.ts` converts each path to an `/@fs/`-servable URL and exposes them via `/__workshop_env__`. `frame.ts` fetches that endpoint and assigns the URLs to `runner.config.setupFiles`, then lets `collectTests` (from `@vitest/runner`) import them itself — `collectTests` calls `clearCollectorContext(file, runner)` (which installs `@vitest/runner`'s module-scoped `runner`/`defaultSuite` state) *before* it runs `config.setupFiles`, so setup code that calls `beforeEach`/`afterEach` at import time (e.g. Tier 2's Angular adapter, below) sees that state already in place. Importing setup files directly in `frame.ts` ahead of `collectTests`, as an earlier version of this did, ran them too early and broke exactly that case. This is the generic fix from `docs/framework-setup-adapters.md`: it covers any consumer whose bootstrapping is "a list of files to import" (custom matchers, MSW setup, etc.).

**Framework adapters (setupFiles) — Tier 2:** frameworks whose bootstrapping can't be expressed as a plain file import (Angular's `TestBed.initTestEnvironment()`, which Angular CLI normally generates as an in-memory virtual module templated by the Architect builder — not something vignet can invoke directly) get a small, framework-specific adapter under `src/node/adapters/`. `resolveFrameworkAdapterEnv(cwd)` in `src/node/adapters/index.ts` runs each registered adapter's `detect(cwd)` and, on the first match, returns its `resolve(cwd)` output; `server.ts` merges the resulting `setupFiles` on top of Tier 1's list before exposing them via `/__workshop_env__`. `src/node/adapters/angular.ts` detects Angular via `angular.json` (a project whose `architect.test.builder` is `@angular/build:unit-test`) and writes a small, vignet-owned setup module calling `TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting())` (plus `zone.js`/`zone.js/testing` if resolvable — zoneless Angular apps have neither). That module is written *inside the consumer's own project tree* (`node_modules/.vignet-adapters/`), not an OS temp directory, and uses bare specifiers (`@angular/core/testing`, not a hand-resolved absolute path) — both are required so the module resolves through Vite's normal pipeline to the *same* module instance (and the same `optimizeDeps` cache entry) that the consumer's own spec files import. Resolving to a different physical copy of `@angular/core/testing` produces a second, distinct `TestBed` whose "initialized" state a spec's own import of `TestBed` never sees, reproducing the original "Need to call TestBed.initTestEnvironment() first" error. Angular's JIT resolution of `templateUrl`/`styleUrl` (`resolveComponentResources()`) is a separate, known gap not covered by this adapter — see `docs/framework-setup-adapters.md`.

**Clean state between variants:** Selecting a different test sets `iframe.src` to a new URL, triggering a full iframe reload. No manual React cleanup needed.

**Communication:** Parent ↔ iframe uses `postMessage` only. No WebSocket, no birpc, no Vitest RPC.

### Key files

| File | Purpose |
| --- | --- |
| `src/cli/cli.ts` | CLI entry — calls `createVitest('test', {watch:true})` then `startVignetServer(vitest)` |
| `src/node/server.ts` | Standalone Vite server: serves workshop UI + frame endpoint, opens browser |
| `src/node/adapters/index.ts` | Tier 2 adapter registry — `resolveFrameworkAdapterEnv(cwd)` |
| `src/node/adapters/angular.ts` | Tier 2 Angular adapter — detects Angular, writes the `TestBed.initTestEnvironment()` setup module |
| `src/node/adapters/types.ts` | `FrameworkAdapter` interface shared by adapter implementations |
| `src/frame.ts` | Iframe runtime — uses `collectTests` to import test file and build suite tree; runs hooks + selected variant |
| `src/ui/App.tsx` | React workshop UI — iframe host + variant trigger button |
| `src/ui/main.tsx` | React entry point — mounts `App` into `#root` |
| `src/plugin.ts` | Vite plugin: virtual `vitest` shim, `@vitest/spy`/`@vitest/runner`/`@vitest/mocker` aliases, `/__workshop_files__` endpoint, `getMockerPlugins()` |
| `src/runtime.ts` | `param(key, default)` helper for future parameterized inputs |
| `src/types.d.ts` | TypeScript module augmentation — extends Vitest's `TaskMeta` with `vignet?: { name?: string }` |
| `src/index.ts` | Package entry — re-exports `param` |
| `example/frontend/src/Button.tsx` | Example consumer component |
| `example/frontend/src/Button.test.tsx` | Example test file — unmodified standard Vitest tests |
| `example/frontend/src/components/ProfileFormPage.tsx` | Example form component with fetch + loading state |
| `example/frontend/src/components/ProfileFormPage.test.tsx` | Example tests using spies, mocks, and lifecycle hooks |
| `example/frontend/src/components/WeatherWidget.tsx` | Example component that uses a module-level service dependency |
| `example/frontend/src/components/WeatherWidget.test.tsx` | Example tests using `vi.mock()` for module mocking — the primary fixture for verifying mock support |
| `example/frontend/vitest.config.ts` | Standard jsdom Vitest config for `npm test` |
| `docs/module-mocking.md` | Architecture doc for `vi.mock()` support — implementation approach, gotchas, what works |

### Vignet CLI server (`src/node/server.ts`)

`vignet` is a **standalone CLI**, not a consumer-facing Vite plugin. `vite` is a peer dependency — vignet uses the consumer's installed Vite, not a bundled copy. `startVignetServer()` calls `createServer()` with `configFile: false` so the consumer's `vite.config.ts` is **not** auto-loaded — the consumer's `server`, `base`, `appType`, and `build` settings would break vignet's own server if inherited. Instead, `loadConsumerPluginsAndResolve()` calls `loadConfigFromFile()` explicitly and extracts **only** the consumer's `plugins` and `resolve` config. Consumer plugins (`vite-tsconfig-paths`, custom resolvers, etc.) are prepended to vignet's plugin list so their `resolveId`/`transform` hooks run and all aliases work. Consumers never need to modify their Vite config.

`startVignetServer()` uses an internal plugin to register its HTTP middleware. This plugin wrapper is required for correct middleware ordering: by the time `createServer()` returns, Vite has already registered its internal middleware (including the SPA HTML fallback). A plugin's `configureServer` hook runs *before* that registration, so vignet's middleware intercepts `/` first. This is the same pattern Vitest uses in `packages/browser/src/node/plugin.ts`.

The middleware serves an HTML shell that loads `src/ui/main.tsx` via `/@fs/<absolute-path>`. Vite's `/@fs/` escape hatch serves files outside `root` when listed in `server.fs.allow`. The HTML is passed through `server.transformIndexHtml('/', html)` before being sent — this injects the `@vitejs/plugin-react` Fast Refresh preamble. Without it, React Fast Refresh throws "can't detect preamble". This matches Vitest's tester middleware pattern (`serverTester.ts` calls `vite.transformIndexHtml(url, testerHtml)`); the difference is we pass `'/'` as the URL since our HTML is generated in-memory rather than read from a file.

**`optimizeDeps.entries` — why it's required:** `main.tsx` and `frame.ts` are served via `/@fs/` from outside the consumer's Vite `root`. Vite's dep scanner only crawls files within `root`, so it never discovers what these files import. Without `entries`, CJS packages like `react-dom/client` are only found by lazy discovery on the first browser request — but the pre-bundling finishes too late, the browser gets the raw CJS file, and the named-import `SyntaxError` is fatal before the HMR client can load (so no auto-reload). `entries: [mainEntry, frameEntry]` tells Vite to scan vignet's own files at startup and pre-bundle everything they need. There is no per-run cost on cached runs; the entry file contents are part of the cache hash.

### Plugin internals

`workshopPlugin()` in `src/plugin.ts` handles iframe test loading and the vitest shim:

- `enforce: 'pre'` — runs before other plugins so the `vitest` alias wins and relative `vi.mock()` paths are rewritten before `hoistMocksPlugin` runs
- `resolveVitest(pkg)` — resolves pnpm-deduped `@vitest/*` packages via vitest's own require context, since pnpm doesn't hoist them to the root `node_modules`. When vignet runs inside a consumer project (common case), `import.meta.url` points to vignet's `dist/` which has no vitest — so the first lookup fails silently and a fallback resolves vitest from `process.cwd()` (the consumer's project root) instead
- `config()` hook returns aliases for `@vitest/spy`, `@vitest/runner`, and `@vitest/mocker/auto-register` (the last points directly to `dist/auto-register.js`, bypassing the package exports map which routes to the wrong file), plus `optimizeDeps: { exclude: [...] }` to prevent pre-bundling
- `transform()` hook has two responsibilities: (1) replaces `__VITEST_GLOBAL_THIS_ACCESSOR__` / `__VITEST_MOCKER_ROOT__` bare identifiers in `@vitest/mocker`'s `register.js` (content-based — avoids path-comparison issues); (2) rewrites relative `vi.mock('./path')` specifiers to project-root-absolute paths before the hoist transform runs
- `resolveId('vitest')` → returns `'\0virtual:workshop-vitest'`
- `load('\0virtual:workshop-vitest')` → returns the shim source
- `configureServer` middleware at `/__workshop_files__` — globs for files matching the `include` pattern, filters to those containing `vignet:` (i.e. at least one workshop view), and returns JSON `{ files: string[] }`

`getMockerPlugins()` in `src/plugin.ts` loads `mockerPlugin()` from `@vitest/mocker/node` and returns it for use in the Vite server config. It also wraps the ws-rpc plugin's `load` hook to strip `?v=HASH` cache-busting query params and `/@fs/` prefixes before the internal path comparison. However, the ws-rpc `load` hook does a strict `id === registerPath` string comparison that still silently fails in pnpm virtual stores (symlink resolution differences between `import.meta.url` inside `@vitest/mocker` and the `id` Vite passes to the load hook). The reliable fix for `register.js` transformation is a content-based `transform` hook in `workshopPlugin` that detects the bare `__VITEST_GLOBAL_THIS_ACCESSOR__` identifier and replaces both placeholders directly — no path comparison needed.

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

### Marking workshop views with `meta.vignet.name`

Test files mark specific tests as workshop views using Vitest's standard `it(name, options, fn)` overload with a `meta.vignet.name` option:

```ts
describe('ProfileFormPage', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('renders the header', { meta: { vignet: { name: 'Header' } } }, () => {
    renderAtRoute()
    expect(screen.getByRole('heading', { name: 'Acme' })).toBeInTheDocument()
  })

  // Regular it() tests still run under `npm test` but are hidden in the workshop
  it('validates email field', () => { ... })
})
```

In workshop mode, the shim's `it` reads `opts.meta?.vignet?.name` and stores it as `vignetviewName` on the registry entry. `frame.ts` filters to only entries with a `vignetviewName` before sending the list to the UI, which displays that name as the sidebar label. In real Vitest (`npm test`), the `meta.vignet` value is stored on `task.meta` by `@vitest/runner` and ignored — tests run normally.

Files with no `vignet:` string are excluded from the sidebar entirely — the `/__workshop_files__` endpoint checks each file for `vignet:` before including it.

**TypeScript setup:** `src/types.d.ts` in `@vignet/workshop` augments Vitest's `TaskMeta` interface with `vignet?: { name?: string }`. Consumer projects activate it by adding `/// <reference types="@vignet/workshop" />` to their test setup file and ensuring that file is in their tsconfig's `include`.

### `param()` for future prop knobs

Test files can import `param` from `@vignet/workshop/runtime`:

```ts
import { param } from '@vignet/workshop/runtime'

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

# In example/frontend/ — start the vignet workshop server
cd example/frontend && npm run vignet   # opens http://localhost:5173/

# In example/frontend/ — run standard Vitest tests (real assertions, jsdom)
cd example/frontend && npm test
```

## Planned Directory Structure

Inferred from `.gitignore` entries:

- `test/fixtures/` — fixture projects for integration tests; each has its own `node_modules/`, `vignet-dist/`, and `workshop-dist/` (all gitignored)
