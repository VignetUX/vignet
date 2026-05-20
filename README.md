# Jibe vitest prototype

## Building and running

For active CLI development, run pnpm dev (tsup --watch) in root — it rebuilds dist/cli.js automatically on every save. Then each pnpm jibe in example/frontend picks up the latest build instantly.

To get a clean build via tsup, you pass --clean on the CLI or clean: true in the config.

To start the jibe workspace run: `pnpm --filter workshop-example jibe`.

## Routing in the workshop

The jibe server only exposes two routes: `/` (workshop UI) and `/frame` (the test iframe). It sets `appType: 'custom'` in `createServer()`, which disables Vite's SPA fallback entirely. Any other path returns a 404 rather than silently serving the consumer app's `index.html`.

Components that use `useParams()` or other React Router hooks need a router context to render. Test files should wrap such components in a `MemoryRouter` (as shown in `ProfileFormPage.test.tsx`). This creates an isolated router context inside the iframe without touching real browser navigation, and is the correct pattern for workshop-previewing any router-dependent component.
