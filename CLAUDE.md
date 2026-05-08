# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **Storybook-style component workshop** for React components. The core idea: existing Vitest test files double as workshop stories. The workshop renders one test variant at a time in an iframe, with assertions silently skipped. Developers get component previews without writing separate story files.

## Architecture

**Chosen approach: plain Vite dev server + custom iframe runtime.** Vitest browser mode was tried first (iter 1) but rejected because:
- Vitest has no concept of "render phase" vs "assertion phase" — you'd be fighting its batch-oriented runner
- Parameter injection has no natural hook point in Vitest's execution model
- The orchestrator RPC/WebSocket layer is unstable internal API that breaks across Vitest versions

The current approach uses Vite only as a module transformer and dev server. There is no Playwright, no Vitest runner, no WebSocket orchestrator.

### How it works

```
Workshop UI  (example/index.html + example/src/ui.ts)
  sidebar: file list + test variant list
  hosts an <iframe>
    ↓  iframe.src = /frame.html?file=/src/Button.test.tsx&run=1
iframe  (example/frame.html + example/src/frame.ts)
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
| `src/plugin.ts` | Vite plugin: virtual `vitest` shim, `/__workshop_files__` endpoint |
| `src/runtime.ts` | `param(key, default)` helper for future parameterized inputs |
| `src/index.ts` | Package entry — re-exports `param` |
| `example/index.html` | Workshop UI shell |
| `example/frame.html` | iframe shell |
| `example/src/ui.ts` | Workshop UI: fetches file list, manages iframe, renders sidebar |
| `example/src/frame.ts` | iframe entry: imports test file, registers tests, runs selected variant |
| `example/vite.config.ts` | Workshop Vite config (uses `workshopPlugin`) |
| `example/vitest.config.ts` | Standard jsdom Vitest config for `npm test` |
| `example/src/Button.tsx` | Example component |
| `example/src/Button.test.tsx` | Example test file — unmodified standard Vitest tests |

### Plugin internals

`workshopPlugin()` in `src/plugin.ts`:
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
cd example
npm run workshop   # Vite dev server → open http://localhost:5173
npm test           # Standard Vitest with jsdom — all tests pass with real assertions
```

## Planned Directory Structure

Inferred from `.gitignore` entries:
- `test/fixtures/` — fixture projects for integration tests; each has its own `node_modules/`, `jibe-dist/`, and `workshop-dist/` (all gitignored)
