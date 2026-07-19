# Vignet

Vignet (pronounced like "vignette") is a frontend scenes workshop generated directly from your vitest unit tests.

This allows you to create frontend scenes of your web app states for full pages as well as design system components using the vitest features you're already familiar with.

## Building and running

`pnpm build` in root runs two steps: `scripts/build-ui.ts` prebuilds vignet's own workshop UI shell (`src/ui/`) into static JS/CSS bundles under `dist/ui-dev` and `dist/ui-build`, then `tsup` bundles the CLI. The prebuild step is what lets vignet ship without requiring consumers to install `@vitejs/plugin-react`, `react`, or `react-dom` — see "Dependencies" below.

For active CLI development, run `pnpm dev` (`tsup --watch`) in root — it rebuilds `dist/cli.js` automatically on every save. This does not re-run the UI prebuild step; re-run `pnpm build` (or `tsx scripts/build-ui.ts`) if you change files under `src/ui/`. Then each `pnpm vignet` in `example/frontend` picks up the latest build instantly.

To get a clean build via tsup, you pass --clean on the CLI or clean: true in the config.

To start the vignet workspace run: `pnpm --filter workshop-example vignet`.

## Dependencies

Vignet's only required peer dependencies are `vite` and `vitest` — both already present in any project vignet is useful for, since vignet's whole premise is turning your existing Vitest test files into workshop stories.

`@vitejs/plugin-react`, `react`, and `react-dom` are **not** required by consumers. Vignet's own workshop UI (the sidebar/iframe host) happens to be written in React, but it's prebuilt into a static bundle at vignet's own release time (see `scripts/build-ui.ts`) and served as-is — it never needs to be transformed in a consumer's project. Whether your own components/tests use React, Vue, or nothing at all is unaffected either way: your own test files still go through whatever plugins your own `vite.config.ts`/`vitest.config.ts` already declares.

## Marking workshop views

Only tests explicitly marked with `meta.vignet.name` appear in the workshop. Use the standard `it(name, options, fn)` overload — no extra imports needed:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('ProfileFormPage', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('renders the header', { meta: { vignet: { name: 'Header' } } }, () => {
    renderAtRoute()
    expect(screen.getByRole('heading', { name: 'Acme' })).toBeInTheDocument()
  })

  // Regular it() tests run under `npm test` but don't appear in the workshop
  it('validates email field', () => { ... })
})
```

- `meta.vignet.name` is the label shown in the workshop sidebar
- Files with no `meta.vignet` calls are excluded from the workshop sidebar entirely
- In `npm test` mode the option is stored on `task.meta` by Vitest and ignored — all tests run normally

**TypeScript setup:** add `/// <reference types="@vignet/workshop" />` to your test setup file (e.g. `test/setup.ts`) and ensure `test/` is in your `tsconfig`'s `include` array. This activates the `TaskMeta` augmentation that makes `meta.vignet` a known type.

## Routing in the workshop

The vignet server only exposes two routes: `/` (workshop UI) and `/frame` (the test iframe). It sets `appType: 'custom'` in `createServer()`, which disables Vite's SPA fallback entirely. Any other path returns a 404 rather than silently serving the consumer app's `index.html`.

Components that use `useParams()` or other React Router hooks need a router context to render. Test files should wrap such components in a `MemoryRouter` (as shown in `ProfileFormPage.test.tsx`). This creates an isolated router context inside the iframe without touching real browser navigation, and is the correct pattern for workshop-previewing any router-dependent component.

## Building example frontend

In `example/frontend`:

- Build static output: `pnpm vignet:build`
- Then serve it: `npx serve workshop-dist`
