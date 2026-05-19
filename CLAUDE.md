# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **Storybook-style component workshop** for React components. The core idea: existing Vitest test files double as workshop stories. The workshop renders one test variant at a time in an iframe, with assertions silently skipped. Developers get component previews without writing separate story files.

## Architecture

**Chosen approach: Vite dev server that interfaces with a vitest instance/server.** Vitest browser mode was tried first (iter 1) but rejected because:
- Vitest has no concept of "render phase" vs "assertion phase" — you'd be fighting its batch-oriented runner
- Parameter injection has no natural hook point in Vitest's execution model
- The orchestrator RPC/WebSocket layer is unstable internal API that breaks across Vitest versions

The current approach uses vitest to leverage its transforms, etc but replaces the orchestrator + browser mode frontend with a custom Jibe vite server frontend. The vitest instance is currently used for its Vite server transforms (JSX/TS resolution). Deeper integration — passing state back through the shared instance — is planned future work.

### How it works

```
Workshop UI  (src/ui/App.tsx, served via src/node/server.ts)
  hosts an <iframe>
    ↓  iframe.src = /frame?file=/src/Button.test.tsx&run=0
iframe  (src/frame.ts, served at /frame by src/node/server.ts)
  sets window.__workshop_registry__ = []
  dynamically imports the test file
    ↓  import { test, expect } from 'vitest'  →  virtual no-op module
  test bodies are captured into __workshop_registry__ without running
  postMessages test list to parent UI
  if ?run=N: calls registry[N].fn()  →  component renders in real DOM
```

**Key interception mechanism:** The Vite plugin (`src/plugin.ts`) intercepts `import ... from 'vitest'` and replaces it with a virtual module. `test`/`it` push closures into `window.__workshop_registry__` instead of executing them. `expect` is a full no-op Proxy. Test files require zero modification.

**Clean state between variants:** Selecting a different test sets `iframe.src` to a new URL, triggering a full iframe reload. No manual React cleanup needed.

**Communication:** Parent ↔ iframe uses `postMessage` only. No WebSocket, no birpc, no Vitest RPC.

### Key files

| File | Purpose |
|---|---|
| `src/cli/cli.ts` | CLI entry — calls `createVitest('test', {watch:true})` then `startJibeServer(vitest)` |
| `src/node/server.ts` | Standalone Vite server: serves workshop UI + frame endpoint, opens browser |
| `src/frame.ts` | Iframe runtime — imports test file, captures registry, calls test fn to render component |
| `src/ui/App.tsx` | React workshop UI — iframe host + variant trigger button |
| `src/ui/main.tsx` | React entry point — mounts `App` into `#root` |
| `src/plugin.ts` | Vite plugin: virtual `vitest` shim + `/__workshop_files__` endpoint |
| `src/runtime.ts` | `param(key, default)` helper for future parameterized inputs |
| `src/index.ts` | Package entry — re-exports `param` |
| `example/frontend/src/Button.tsx` | Example consumer component |
| `example/frontend/src/Button.test.tsx` | Example test file — unmodified standard Vitest tests |
| `example/frontend/vitest.config.ts` | Standard jsdom Vitest config for `npm test` |

### Jibe CLI server (`src/node/server.ts`)

`jibe` is a **standalone CLI**, not a consumer-facing Vite plugin. Like Vitest, it creates its own Vite server via `createServer()` with `configFile: false` (consumer's `vite.config.ts` is intentionally ignored). Consumers never touch their Vite config.

`startJibeServer()` uses an internal plugin to register its HTTP middleware. This plugin wrapper is required for correct middleware ordering: by the time `createServer()` returns, Vite has already registered its internal middleware (including the SPA HTML fallback). A plugin's `configureServer` hook runs *before* that registration, so jibe's middleware intercepts `/` first. This is the same pattern Vitest uses in `packages/browser/src/node/plugin.ts`.

The middleware serves an HTML shell that loads `src/ui/main.tsx` via `/@fs/<absolute-path>`. Vite's `/@fs/` escape hatch serves files outside `root` when listed in `server.fs.allow`. The HTML is passed through `server.transformIndexHtml('/', html)` before being sent — this injects the `@vitejs/plugin-react` Fast Refresh preamble. Without it, React Fast Refresh throws "can't detect preamble". This matches Vitest's tester middleware pattern (`serverTester.ts` calls `vite.transformIndexHtml(url, testerHtml)`); the difference is we pass `'/'` as the URL since our HTML is generated in-memory rather than read from a file.

### Plugin internals

`workshopPlugin()` in `src/plugin.ts` is included in the jibe server's plugin list and handles iframe test loading:
- `enforce: 'pre'` — runs before other plugins so the `vitest` alias wins
- `config()` hook returns `{ optimizeDeps: { exclude: ['vitest'] } }` — prevents Vite from pre-bundling the real `vitest` package, which would bypass `resolveId`
- `resolveId('vitest')` → returns `'\0virtual:workshop-vitest'`
- `load('\0virtual:workshop-vitest')` → returns the no-op shim source
- `configureServer` middleware at `/__workshop_files__` — globs for files matching the `include` pattern and returns JSON `{ files: string[] }`

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
