# Generalize test-environment bootstrapping (setupFiles) across frameworks

Status: Tier 1, Tier 2 (Angular `TestBed.initTestEnvironment()` adapter), and Tier 3 (Angular `templateUrl`/`styleUrl` JIT resolution) implemented. See `CLAUDE.md`'s "Test-environment bootstrapping" and "Framework adapters" sections for the as-built design — it differs in one important way from the plan below: `frame.ts` assigns setup file URLs to `runner.config.setupFiles` and lets `@vitest/runner`'s `collectTests` import them itself, rather than importing them directly before calling `collectTests`. `collectTests` installs `@vitest/runner`'s module-scoped runner state (via `clearCollectorContext`) before running `config.setupFiles`; importing them ourselves ahead of that call ran them too early, breaking the Angular adapter's setup module, which calls `beforeEach`/`afterEach` internally.

## Tier 3: templateUrl/styleUrl JIT resolution

Once Tier 2 was working, components using `templateUrl`/`styleUrl` (the Angular CLI default) still failed with `Component 'X' is not resolved... Did you run and wait for 'resolveComponentResources()'?` — unrelated to `setupFiles`/`TestBed.initTestEnvironment()`.

Root cause: nothing in vignet's dev server resolves `templateUrl`/`styleUrl` at all. Angular CLI's real Vitest builder doesn't resolve them at runtime either — it rewrites `@Component()` decorators at **compile time**, inlining referenced files as `template`/`styles` before Vitest ever runs (`@angular/build/src/tools/angular/transformers/jit-resource-transformer.js` + `.../tools/esbuild/angular/jit-plugin-callbacks.js` in a real Angular project's `node_modules`). That whole pipeline is a TS `Program`-level AST transformer plus esbuild `onResolve`/`onLoad` callbacks wired into a whole-program esbuild bundle (`buildApplicationInternal`) — explicitly marked private/unsupported outside `@angular-devkit/build-angular` (`@angular/build/src/private.d.ts`) and incompatible with Vite's per-file transform model.

`TestBed.compileComponents()` does contain a runtime fallback calling `resolveComponentResources()` (from `@angular/core`), but it's not usable standalone: the resolver needs `ResourceLoader` injected via DI, an abstract class (`node_modules/@angular/compiler/fesm2022/compiler.mjs`) with **no default provider anywhere** in `@angular/core`/`@angular/platform-browser`/`@angular/build`, and even with a provider, the resolver callback only receives the literal `templateUrl` string — no way to know which file it's relative to.

**Fix**: `src/node/adapters/angular-jit-resources.ts` reproduces the *effect* of Angular's compile-time transform, not its mechanism. It's a `FrameworkAdapter.vitePlugin` (new optional hook on the `FrameworkAdapter` interface, alongside `resolve()`) contributed by `angularAdapter` and merged into the Vite plugin list by `server.ts` only when Angular is detected. Using the `typescript` package (always present in an Angular project, resolved from the consumer the same way `resolveVitest()` resolves vitest sub-packages), it walks `@Component({...})` decorators and rewrites `templateUrl`/`styleUrl`/`styleUrls` properties into `template`/`styles`, backed by synthetic imports appended to the top of the file using Vite's own `?raw` (file contents as a string) and `?inline` (processed CSS as a string, not injected) query conventions — this reuses Vite's file-loading and Sass/PostCSS pipeline for free instead of reimplementing it, and is far smaller than reproducing esbuild's `onResolve`/`onLoad` machinery. `enforce: 'pre'` so the transform sees raw TS with decorators intact, before Vite's esbuild TS transform strips them.

**Newly discovered, still-open gap**: fixing this surfaced a distinct error for components with constructor-injected services — `NG0202: This constructor is not compatible with Angular Dependency Injection`. Root cause: Vite's default esbuild-based TS transform doesn't support TypeScript's `emitDecoratorMetadata`, so Angular's JIT compiler never sees constructor parameter types and can't resolve DI tokens. Confirmed via the linked example project: `Button` (no injected deps) renders correctly; `WeatherWidget` (injects `WeatherService`) hits `NG0202`. Not yet addressed — likely requires either a `typescript`-based transform (mirroring this Tier 3 fix's approach) that emits `design:paramtypes` metadata, or an esbuild/Vite plugin that does the same.

## Context

Two bugs surfaced while debugging the Angular example (`my-vignet-angular-example`):

1. **`describe is not defined`** — already fixed. Root cause: vignet's virtual `vitest` shim only activates when a spec file does `import ... from 'vitest'`. Angular CLI's generated specs never do that (they rely on Vitest's `globals: true`), so the shim never installed `describe`/`it`/`expect`. Fix: `frame.ts` now installs the shim's exports onto `globalThis` unconditionally, matching how real Vitest's `globals: true` behaves.

2. **`Need to call TestBed.initTestEnvironment() first`** — the next error, once collection succeeds. Root cause: `frame.ts`'s minimal `VitestRunner` hardcodes `setupFiles: []` in its `config`, and **nothing in vignet ever executes any setup files at all** — not for Angular, not for anyone. This has been silently masked for the React example (`example/frontend/test/setup.ts` imports `@testing-library/jest-dom`, which only matters if `expect(...).toBeInTheDocument()` actually throws — but vignet's `expect` is a no-op proxy, so the missing jest-dom matchers were never noticed).

   For Angular specifically, real setup is more than "import a file": `@angular/build:unit-test`'s Vitest runner (`node_modules/@angular/build/src/builders/unit-test/runners/vitest/*`) generates `init-testbed.js` as an **in-memory virtual module** (`angular:test-bed-init`) whose source is templated based on the project's zone.js/polyfill strategy and build options — it is not a file on disk vignet can just `import()`. There is no public, lightweight API on `@angular/build` to ask "give me the resolved setup files" outside of running the full Architect builder.

The goal is to keep the *generic* path framework-agnostic (no hardcoded per-framework logic baked into `frame.ts`/`plugin.ts`), while allowing a small number of clearly isolated, explicit per-framework adapters where a framework's test bootstrapping genuinely can't be expressed generically (Angular's TestBed).

## Design

**Tier 1 — generic: actually run the consumer's real `setupFiles` (fixes this for every normal Vitest consumer, zero framework-specific code)**

- `startDevServer` in `src/cli/cli.ts` already builds a real, fully-resolved `vitest` instance via `createVitest('test', { watch: true })`. `vitest.config.setupFiles` is already the correct absolute-path list Vitest itself would run — vignet just never threads it anywhere or executes it.
- Add a new middleware endpoint in `src/node/server.ts`, alongside the existing `/__workshop_files__` one: `/__workshop_env__` returning `{ setupFiles: string[] }` (absolute paths converted to `/@fs/`-servable URLs, same convention `frameEntry` already uses).
- In `src/frame.ts`, before calling `collectTests`, fetch `/__workshop_env__` and `await import(/* @vite-ignore */ f)` each setup file in order — mirroring what Vitest's own worker does before running tests. This is pure plumbing, no framework awareness.

This alone fixes any consumer whose test bootstrapping is "a list of files to import" — Vue, Svelte, SolidJS, and React projects doing more than the current example (e.g. MSW server setup, custom matchers).

**Tier 2 — pluggable per-framework adapters (isolated, opt-in, only where Tier 1 can't express the need)**

- New directory `src/node/adapters/` with a tiny interface:
  ```ts
  interface FrameworkAdapter {
    name: string
    detect(cwd: string): boolean | Promise<boolean>
    // Returns extra setup-file URLs/module sources and config overrides to merge
    // on top of the generic vitest.config resolution from Tier 1.
    resolve(cwd: string): Promise<{ setupFiles?: string[]; environment?: string; globals?: boolean }>
  }
  ```
- `src/node/adapters/angular.ts`: detects Angular by checking for `@angular/core/testing` + an `architect.test.builder === '@angular/build:unit-test'` entry in `angular.json` (cheap, reliable signal — no need to invoke Angular's builder). If detected, contributes a small, hand-written, vignet-owned setup module that calls `TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting())` (imported from `@angular/platform-browser/testing`, resolved the same way `resolveVitest()` in `plugin.ts` resolves pnpm-deduped packages) plus a zone.js import if present. This is **not** a reverse-engineered copy of Angular's internal virtual module — it's the minimal, documented, stable public API surface for TestBed initialization, written once and easy to read in one file.
- `src/node/adapters/index.ts` exports `resolveFrameworkAdapterEnv(cwd)`: runs `detect()` over the registered adapters, returns the first match's `resolve()` output (or `{}` if none match).
- `server.ts`'s `/__workshop_env__` handler merges: `{ setupFiles: [...tier1SetupFiles, ...adapterSetupFiles], ...adapterOverrides }`.

This keeps `frame.ts` and `plugin.ts` (the shared core) completely framework-agnostic — they just import whatever `setupFiles` list they're given. All Angular-specific knowledge lives in one small, well-commented file that explains *why* it exists (same documentation style already used for the Vitest-orchestrator-avoidance decision in `CLAUDE.md`), making it easy to audit and to add a `vue.ts`/`svelte.ts` adapter later if a similar gap appears.

## Files to touch

| File | Change |
| --- | --- |
| `src/node/server.ts` | Add `/__workshop_env__` middleware handler; call `resolveFrameworkAdapterEnv(cwd)` and merge with `vitest.config.setupFiles` |
| `src/frame.ts` | Fetch `/__workshop_env__`, `import()` each setup file before `collectTests` |
| `src/node/adapters/index.ts` | New — adapter registry + `resolveFrameworkAdapterEnv()` |
| `src/node/adapters/angular.ts` | New — Angular TestBed adapter (detect via `angular.json`, minimal setup module) |
| `CLAUDE.md` | Document the two-tier setupFiles design and why the Angular adapter exists (matches existing doc style for other architectural decisions) |

## Verification

1. Restart `pnpm vignet` in `my-vignet-angular-example`, reload the workshop, click `button.spec.ts` → `Primary`. Confirm the `TestBed.initTestEnvironment()` error is gone and the button renders in the iframe.
2. In `example/frontend`, run `npm run vignet`, click through `WeatherWidget.spec.tsx` and `ProfileFormPage.spec.tsx` variants (these exercise `vi.mock`/spies) to confirm Tier 1's now-executing `test/setup.ts` doesn't break existing mocking/rendering behavior.
3. `cd example/frontend && npm test` — confirm real Vitest run is unaffected (Tier 1/2 code only runs inside vignet's own dev server path, not the consumer's `npm test`).
