# Static Build Architecture (`jibe build`)

## Goal

Produce a fully static deployable output so the workshop can be hosted on any CDN with no Node.js server. This is the intended SaaS deployment model: consumer runs `jibe build` in CI, uploads the output, and the SaaS serves it statically.

## Why Static Is Viable Despite Mocks

The initial concern was that `vi.mock()` requires Vite's HMR WebSocket. But HMR is a *dev* concern — it exists to push code changes to a running browser. In a deployed workshop, the source code is fixed. We only need mocks to work on the initial load, not be dynamically updated.

The current runtime flow:
1. `vi.mock('id', factory)` sends the factory to the server over HMR WebSocket
2. When the browser imports `'id'`, the Vite server intercepts and returns the factory result

For a static build, we replace this with a **build-time transform**: the mock factory is inlined directly where the import was, so the mocked module is never loaded at all.

```ts
// Original test file
vi.mock('./weatherService', () => ({ getWeather: vi.fn().mockReturnValue('sunny') }))
import { getWeather } from './weatherService'

// After build-time transform (in the emitted bundle)
const __mock_0 = (() => ({ getWeather: vi.fn().mockReturnValue('sunny') }))()
const { getWeather } = __mock_0
// The real ./weatherService is never imported
```

The factory runs in the browser. `vi.fn()` comes from the bundled `@vitest/spy` — it works correctly. No server, no WebSocket, no service worker.

## Static Output Layout

```
dist/
  index.html          ← workshop UI shell (pre-built React app)
  frame.html          ← frame shell (loads test bundle via ?bundle= query param)
  frame.js            ← pre-built static frame runtime
  assets/             ← UI JS/CSS chunks
  tests/
    abc123.js         ← Button.test.tsx bundle (vi.mock() factories inlined)
    def456.js         ← WeatherWidget.test.tsx bundle
  manifest.json       ← maps file paths → bundle filenames → workshop view names
```

Deploying `dist/` to any static host (S3, Netlify, GitHub Pages, Vercel) is sufficient.

## How the Built Workshop Loads a View

1. Browser loads `index.html` → React UI fetches `./manifest.json`
2. UI renders the sidebar from the manifest (file names → view names)
3. Selecting a view sets `<iframe src="frame.html?bundle=abc123.js&run=2">`
4. `frame.html` loads `frame.js`, which reads `?bundle=` and dynamically imports `./tests/abc123.js`
5. The bundle populates `window.__workshop_registry__` on load (each entry includes pre-captured hook functions)
6. The frame runs hooks + `registry[2].fn()` — the selected workshop view renders

This is the same lifecycle as dev mode. The only difference is step 4: instead of Vite's `import(filepath)` triggering a server-side transform, a pre-built bundle is loaded from a static file.

## Virtual Vitest Shim in Static Builds

In dev mode, the virtual vitest shim (`virtual:workshop-vitest`) delegates hooks to `@vitest/runner` for correct suite-scoped ordering, which is then used by `frame.ts` with `getHooks()`.

In static builds, **`@vitest/runner` is not available at runtime** — the test bundle is self-contained and has no way to share a `@vitest/runner` module instance with the frame's runtime. Instead, `workshopPlugin({ buildMode: true })` injects a different virtual shim (`virtual:workshop-vitest-static`) that captures hooks directly per-test at registration time:

- `describe()` pushes/pops a hook frame on a local stack
- `beforeEach/afterEach/beforeAll/afterAll` push to the current frame
- `test()` snapshots the full hook chain at registration time and stores it in the registry entry as `{ hooks: { beforeAll, beforeEach, afterEach, afterAll } }`

Because the workshop renders one test at a time per iframe, `beforeAll` running once per view is identical in behavior to dev mode (each view is an isolated iframe reload). No `@vitest/runner` dependency in the test bundle or frame runtime.

## The Build-Time Mock Plugin (`buildMockPlugin`)

A new Vite plugin in `src/node/build-plugin.ts` handles mock inlining during `vite build`. It runs after `hoistMocksPlugin` (which already moves all `vi.mock()` calls before imports — this transform is pure and works fine at build time).

**Transform steps for each test file:**

1. Parse the file and collect all `vi.mock(id, factory)` calls
2. Resolve each `id` relative to the file root → root-relative path
3. For each `import` statement whose resolved path is in the mock set:
   - Named imports: `import { x, y } from 'id'` → `const __mock_N = (factory)(); const { x, y } = __mock_N`
   - Default import: `import foo from 'id'` → `const __mock_N = (factory)(); const foo = __mock_N.default ?? __mock_N`
   - Namespace import: `import * as ns from 'id'` → `const ns = (factory)()`
4. Remove the `vi.mock(id, factory)` call from the output

**Auto-mocks (`vi.mock('id')` with no factory)** are not supported. The plugin emits a build warning and leaves the import untouched (the real module is bundled). This means components that rely on auto-mocked services may render incorrectly or throw in the static build.

> **Known gap**: `example/frontend/src/components/WeatherWidget.test.tsx` uses `vi.mock('../services/weatherService')` with no factory. Its views will render with the unmocked service, which will likely show an error state in the static build. This works correctly in dev mode.

**`dynamicImportPlugin`** (from `@vitest/mocker`) is excluded from build mode — it wraps imports for the runtime interceptor's timing coordination, which is not needed when mocks are inlined.

## What Works vs. What Doesn't in Static Builds

| Feature | Dev mode | Static build |
|---|---|---|
| `vi.fn()`, `vi.spyOn()`, `vi.restoreAllMocks()` | ✓ | ✓ |
| Factory mocks: `vi.mock('id', () => ...)` | ✓ | ✓ (build-time inlined) |
| `beforeEach` / `afterEach` / `beforeAll` / `afterAll` | ✓ | ✓ (captured per-test in static shim) |
| `expect` (no-op, assertions silently skipped) | ✓ | ✓ |
| Auto-mocks: `vi.mock('id')` with no factory | ✓ | ✗ (warning, real module bundled) |
| `vi.doMock()` / `vi.doUnmock()` (runtime conditional) | ✓ | ✗ (no-op) |
| HMR live reload | ✓ | ✗ (not applicable) |

## Supporting `vi.doMock()` / `vi.doUnmock()` in Static Builds

Not implemented. See the `vi.doMock()` section below for approach options if this is needed later.

`vi.doMock()` is fundamentally different from `vi.mock()`: it is not hoisted, executes at its lexical position, and changes which module future `import()` calls return. The standard pattern is `vi.doMock(id, factory)` followed by `const mod = await import(id)`. This is inherently runtime behavior — in a pre-bundled ES module there is no interceptor between `import()` and the bundled chunk.

Three approaches exist, each with different tradeoffs:

### Option 1: Build-time import rewriting + runtime registry (recommended)

**Build-time changes in `buildMockPlugin`:**

1. Identify all `vi.doMock(id, factory)` and `vi.doUnmock(id)` calls; resolve `id` to absolute paths and rewrite the string literals in-place so the runtime has canonical keys.
2. Rewrite every dynamic `import()` call in the test file to `__workshop_import__()` — this is the hook point.
3. Emit `doMock`'d modules as separate lazy chunks (not inlined into the test bundle) so the real module remains loadable.

```ts
// Original
vi.doMock('./service', () => ({ fetch: vi.fn() }))
const { fetch } = await import('./service')

// After build transform
vi.doMock('/abs/path/to/service.ts', () => ({ fetch: vi.fn() }))
const { fetch } = await __workshop_import__('/abs/path/to/service.ts')
```

**Runtime additions to the virtual vitest shim:**

```ts
const __mock_registry__ = new Map()
vi.doMock = (id, factory) => __mock_registry__.set(id, factory)
vi.doUnmock = (id) => __mock_registry__.delete(id)

async function __workshop_import__(id) {
  if (__mock_registry__.has(id)) return __mock_registry__.get(id)()
  return import(/* @vite-ignore */ id)
}
```

**Hard limitation:** only works when the `import()` specifier is a string literal. Variable expressions like `await import(moduleName)` cannot be resolved at build time. In practice this covers nearly all test-file usage. The build plugin should emit a warning when a non-literal `import()` follows a `vi.doMock()` in the same scope.

### Option 2: ES Module Shims

[`es-module-shims`](https://github.com/guybedford/es-module-shims) re-implements the browser ES module loader with interceptable hooks. An import hook would check the mock registry before loading any module, solving the variable-specifier problem since the hook fires for every `import()` at runtime.

Downside: ESMS re-parses all ES module source in the browser (it is a full polyfill layer), adding meaningful overhead (~100 KB) and re-parse cost for every module — wide blast radius for a narrow feature.

### Option 3: Service Worker

A service worker can intercept `fetch()` requests for module scripts and return factory results for registered mocks. This is how `@vitest/mocker` works in Vitest's native browser mode.

Downside: requires HTTPS or localhost (rules out some CDN preview flows), service worker registration must complete before any test module loads (sequencing complexity in `frame.html`), and adds an operational artifact to every static deployment.

### Comparison

| Approach | Handles variable `import()` | Bundle overhead | Deployment constraints |
|---|---|---|---|
| Build-time rewrite (Option 1) | ✗ string literals only | Minimal | None |
| ES Module Shims (Option 2) | ✓ | ~100 KB + re-parse | None |
| Service Worker (Option 3) | ✓ | Small worker script | HTTPS required |

## New Files and Changes

| File | Change |
|---|---|
| `src/node/build.ts` | New — build orchestrator: discovers files, runs Vite builds, emits `manifest.json` |
| `src/node/build-plugin.ts` | New — `buildMockPlugin()`: build-time vi.mock() factory inlining |
| `src/plugin.ts` | Add `buildMode` option to `workshopPlugin()` (skips server middleware + uses static shim); add `VIRTUAL_VITEST_STATIC_SRC` (static hook-capture shim); extract `discoverWorkshopFiles()` helper |
| `src/frame-static.ts` | New — standalone static frame runtime: loads `?bundle=` script, reads registry with hooks, runs selected view |
| `src/node/templates.ts` | Add `frameBuildHtml()` for the static frame shell |
| `src/ui/App.tsx` | Detect `__JIBE_BUILD_MODE__` compile-time constant; fetch `manifest.json` and use bundle-based iframe URLs in build mode |
| `src/cli/cli.ts` | Restructure with `cac` to support `dev` (default) and `build [--out <dir>]` subcommands |

## Build Orchestration

```ts
// src/node/build.ts
async function buildWorkshop(root: string, outDir: string) {
  const files = await discoverWorkshopFiles(root, include)  // same glob + jibe: filter as dev mode

  // Build the UI shell (React app) — injects __JIBE_BUILD_MODE__ compile-time constant
  await vite.build({ plugins: [react(), workshopPlugin({ buildMode: true })], define: { __JIBE_BUILD_MODE__: 'true' }, ... })

  // Build the static frame runtime
  await vite.build({ entry: resolve(jibeDir, 'src/frame-static.ts'), ... })

  // Build each test file as an isolated ES module bundle
  const manifest = []
  for (const file of files) {
    const hash = shortHash(file)
    await vite.build({
      plugins: [workshopPlugin({ buildMode: true }), hoistMocksPlugin(), buildMockPlugin()],
      build: { lib: { entry: file, formats: ['es'], fileName: () => `${hash}.js` }, outDir: `${outDir}/tests` },
    })
    manifest.push({ path: relative(root, file), bundle: `${hash}.js`, views: extractViewNames(file) })
  }

  writeFileSync(`${outDir}/manifest.json`, JSON.stringify({ files: manifest }, null, 2))
}
```

## Consumer Workflow

```bash
# Run the static build from the consumer project root
npx jibe build --out ./workshop-dist

# Verify output
cat workshop-dist/manifest.json
ls workshop-dist/tests/

# Preview locally
npx serve workshop-dist

# Deploy (example: Jibe CLI)
Jibe deploy --dir workshop-dist --prod
```

For CI, add a step after `npm test` to run `jibe build` and upload `workshop-dist/` to the SaaS or a CDN bucket.
