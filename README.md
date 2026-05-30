# Jibe vitest prototype

## Building and running

For active CLI development, run pnpm dev (tsup --watch) in root — it rebuilds dist/cli.js automatically on every save. Then each pnpm jibe in example/frontend picks up the latest build instantly.

To get a clean build via tsup, you pass --clean on the CLI or clean: true in the config.

To start the jibe workspace run: `pnpm --filter workshop-example jibe`.

## Marking workshop views

Only tests explicitly marked with `meta.jibe.name` appear in the workshop. Use the standard `it(name, options, fn)` overload — no extra imports needed:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('ProfileFormPage', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('renders the header', { meta: { jibe: { name: 'Header' } } }, () => {
    renderAtRoute()
    expect(screen.getByRole('heading', { name: 'Acme' })).toBeInTheDocument()
  })

  // Regular it() tests run under `npm test` but don't appear in the workshop
  it('validates email field', () => { ... })
})
```

- `meta.jibe.name` is the label shown in the workshop sidebar
- Files with no `meta.jibe` calls are excluded from the workshop sidebar entirely
- In `npm test` mode the option is stored on `task.meta` by Vitest and ignored — all tests run normally

**TypeScript setup:** add `/// <reference types="@jibe/workshop" />` to your test setup file (e.g. `test/setup.ts`) and ensure `test/` is in your `tsconfig`'s `include` array. This activates the `TaskMeta` augmentation that makes `meta.jibe` a known type.

## Routing in the workshop

The jibe server only exposes two routes: `/` (workshop UI) and `/frame` (the test iframe). It sets `appType: 'custom'` in `createServer()`, which disables Vite's SPA fallback entirely. Any other path returns a 404 rather than silently serving the consumer app's `index.html`.

Components that use `useParams()` or other React Router hooks need a router context to render. Test files should wrap such components in a `MemoryRouter` (as shown in `ProfileFormPage.test.tsx`). This creates an isolated router context inside the iframe without touching real browser navigation, and is the correct pattern for workshop-previewing any router-dependent component.

## Building example frontend

In `example/frontend`:

- Build static output: `pnpm jibe:build`
- Then serve it: `npx serve workshop-dist`
