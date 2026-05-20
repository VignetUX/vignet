# Module mocking in the Jibe workshop

## Status: not yet implemented — feasible future work

---

## Background: why it was previously infeasible

ESM imports are hoisted — they execute before any module body code:

```js
import _ from 'lodash'       // runs FIRST in ESM
vi.mock('lodash', () => ...) // would run AFTER lodash is already imported
```

Vitest solves this with a Vite transform plugin that physically rewrites test files to move `vi.mock(...)` calls before the import statements. Without that transform, the mock registration is always too late.

Jibe previously imported test files via a bare `await import(file)` in `frame.ts`. There was no hook point to set up interception before the file's static imports ran. This made module mocking infeasible without replicating vitest's hoist transform.

---

## What changed with the `collectTests` adoption

Jibe now uses `@vitest/runner`'s `collectTests([file], runner)`, which imports the file through a controlled `runner.importFile(filepath)` call. This gives jibe **a hook point before the import executes**.

The new approach:

1. Fetch the raw file source before `runner.importFile` (one extra `fetch` call to the Vite server)
2. Parse `vi.mock('module-id')` calls from the source (regex or lightweight AST scan)
3. Register those module IDs with the Vite server via a new `/__workshop_mock__` endpoint
4. A Vite `resolveId`/`load` hook intercepts requests for mocked module IDs and serves mocked versions
5. Then call `runner.importFile` — the test file's static imports now hit the interceptors

This eliminates the need for the hoist transform: since the interception is set up server-side before the import is triggered, the mocked modules are in place when the file's static imports evaluate.

---

## Implementation paths

### Auto-mocks — no factory (estimated ~80 lines)

```js
vi.mock('lodash') // no second argument
```

The server analyzes the real module's exports and returns auto-generated `vi.fn()` stubs for each. No factory needed, so no browser/server JS-execution boundary to cross.

Work required:
- New `/__workshop_mock__` endpoint to receive mock registrations
- `resolveId` hook to redirect registered IDs to a virtual module
- `load` hook to generate the auto-mock source (analyze real module, emit `vi.fn()` per export)

### Factory mocks (estimated ~150 lines)

```js
vi.mock('lodash', () => ({ cloneDeep: vi.fn() }))
```

The factory function must run in the browser (so `vi.fn()` and other browser-context globals are in scope). The factory is defined in the test file, which creates a timing problem: we need the factory before the file is imported, but the factory is only available after.

The escape hatch: a Vite source transform that extracts factory functions into separate virtual modules. The virtual module is evaluated lazily at mock-import time — the factory runs in the browser when `lodash` is first imported by the test file.

Work required: everything in auto-mocks, plus a Vite `transform` hook that rewrites `vi.mock('id', factory)` to store the factory in a virtual module registry.

---

## What still won't work

| Approach | Why |
|---|---|
| `ModuleMockerServerInterceptor` from `@vitest/mocker` | Uses `rpc("vitest:interceptor:register", ...)` — requires the vitest birpc bridge that jibe doesn't set up |
| `ModuleMockerMSWInterceptor` from `@vitest/mocker` | Uses a Service Worker for browser-side interception — requires MSW to be installed in the consumer's project |

---

## Summary

| Scenario | Before `collectTests` | After `collectTests` |
|---|---|---|
| `vi.mock('module')` auto-mock | Not feasible (no pre-import hook) | **Feasible** (~80 lines) |
| `vi.mock('module', factory)` | Not feasible | Feasible, harder (~150 lines) |
| Via vitest RPC/MSW infrastructure | Not feasible | Still not feasible |
