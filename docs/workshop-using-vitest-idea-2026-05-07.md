# Component Workshop on Vitest Browser Mode — Architecture Notes
*2026-05-07*

## The Idea

Build a Storybook-style component workshop using Vitest's browser mode as the
execution substrate, with a custom UI replacing the default `@vitest/ui` dashboard.
A "story" is a Vitest test file that renders a component instead of asserting —
the tester iframe displays it, and the custom orchestrator UI provides controls
(variant picker, prop knobs, viewport resizer).

## Chosen Approach: Vite Dev Server + Custom Orchestrator UI

Keep the full Vitest browser mode infrastructure intact. Replace only the
orchestrator page (the shell the user interacts with) with a custom workshop UI.

### Why Not Go Fully Static

A fully static build (no Node server at runtime, served from CDN like Storybook)
would require:
- Surgically removing the birpc WebSocket layer from Vitest's client code, which
  has server assumptions woven throughout
- Replacing server-generated per-session tokens with static constants
- Reimplementing mock resolution at build time (currently uses Vite's plugin
  pipeline + filesystem at request time)
- Forking and maintaining significant chunks of `packages/browser/src/client/`

Estimated effort: 8–16 weeks with ongoing maintenance risk on every Vitest update.
The dev server approach is 2–4 weeks of mostly UI/product work on top of
infrastructure that already works.

### Why the Dev Server Is Fine at Runtime

Once component code is warmed in Vite's module graph, the dev server is nearly
idle — no live editing, no HMR, no re-transpilation happening. Per-session Node
overhead is low. Optimizing to static hosting is a future option if scale demands
it; the static approach is not foreclosed.

---

## Required Changes

### 1. Vite Middleware Plugin — Intercept the Orchestrator Route

There is no config option to swap in a custom orchestrator HTML. The `browser.ui`
toggle hardcodes which HTML is served (either `packages/ui`'s built output or a
minimal `orchestrator.html`). The fix is a Vite plugin that intercepts
`/__vitest_test__/` and serves your own HTML instead.

```ts
// vitest.config.ts
{
  name: 'workshop-orchestrator',
  configureServer(server) {
    server.middlewares.use('/__vitest_test__/', (_req, res) => {
      res.setHeader('Content-Type', 'text/html')
      res.end(/* your custom orchestrator HTML string */)
    })
  }
}
```

**Reference:** `packages/browser/src/node/middlewares/orchestratorMiddleware.ts`

### 2. Custom Orchestrator UI

Your orchestrator page replaces `packages/ui`. It connects to Vitest's existing
infrastructure over WebSocket:

- Open WebSocket to `/__vitest_browser_api__?type=orchestrator&rpcId={uuid}`
- Use `birpc` with the `flatted` serializer (same as existing UI does)
- Subscribe to test lifecycle events:
  - `onCollected` — story/variant list becomes available
  - `onTaskUpdate` — pass/fail/running state per variant
  - `onQueued`, `onFinished`, `onUserConsoleLog`
- Trigger execution by calling `createTesters({ files: [...] })` over RPC
- UI surface: component variant list, props controls, viewport resizer, status

**Reference implementation to copy:**
- `packages/ui/client/composables/client/ws.ts` — WebSocket + birpc wiring
- `packages/ui/client/composables/client/state.ts` — StateManager pattern for
  accumulating test results reactively

### 3. Custom Tester HTML (Optional but Recommended)

The `testerHtmlPath` config option lets you supply custom HTML for the component
iframe (where components actually render). Useful for injecting design tokens,
a wrapper layout div, global CSS resets, or workshop-specific globals.

```ts
// vitest.config.ts
test: {
  browser: {
    testerHtmlPath: './workshop-tester.html'
  }
}
```

**Reference:** `packages/browser/src/node/serverTester.ts`

### 4. Story File Convention

Define a convention for story files (e.g. `*.workshop.ts`) that Vitest collects
as test files. Each story uses a `mount()` helper that renders and holds the
component visible in the iframe instead of asserting:

```ts
// Button.workshop.ts
import { workshopMount } from '@your-workshop/runtime'
import { Button } from './Button'

test('primary', () => workshopMount(Button, { label: 'Click me', variant: 'primary' }))
test('danger',  () => workshopMount(Button, { label: 'Delete',   variant: 'danger' }))
```

The orchestrator lists variants from `onCollected` results. Selecting a variant
re-triggers that individual test via `createTesters({ files: [file] })`.

### 5. Parameter Re-runs (Prop Knobs / Viewport Changes)

When a user adjusts a prop knob or viewport size in your UI:

- **Viewport:** call `triggerCommand(sessionId, 'setViewport', undefined, [{ width, height }])`
  — this maps to Vitest's existing `setViewport` browser command
- **Props:** simplest approach is to encode prop values as URL params on the tester
  iframe URL and re-trigger the test; the story reads `new URLSearchParams(location.search)`
- Re-run is cheap: `createTesters({ files: [currentFile] })` tears down and
  respawns the tester iframe with the new URL params

---

## Cloud / SaaS Deployment

A Node server is required per session (cannot be fully static). Minimum unit:

```
[User's browser]
    ↕ HTTP + WebSocket (sticky session required)
[Node process]
    ├─ Vite dev server  (serves + transforms component code)
    ├─ birpc WebSocket server at /__vitest_browser_api__
    └─ Chromium via Playwright (headless, renders the iframes)
         └─ Orchestrator page + component tester iframes
```

**Recommended starting architecture (Option A — container per session):**
- Spin up an ephemeral container (Node + Chromium) per workshop session
- Kill after inactivity timeout (e.g. 15 min)
- Load balancer with sticky sessions (all requests for a session hit the same container)
- Cold-start latency is the main UX cost; mitigate with pre-warmed container pools

**Future scaling option (Option B — remote browser):**
- Node server fleet handles Vite + RPC
- Remote browser service (Browserless.io, Playwright Grid) handles Chromium
- Separates compute scaling concerns; more complex initial setup

---

## Key Reference Files in the Vitest Codebase

| File | Why it matters |
|---|---|
| `packages/browser/src/node/middlewares/orchestratorMiddleware.ts` | The route your plugin intercepts |
| `packages/browser/src/node/serverOrchestrator.ts` | How the existing orchestrator HTML is generated |
| `packages/browser/src/node/serverTester.ts` | How tester HTML is generated; see `testerHtmlPath` handling |
| `packages/browser/src/node/rpc.ts` | Full WebSocket RPC handler — all message types |
| `packages/browser/src/types.ts` | `WebSocketBrowserHandlers` and `WebSocketBrowserEvents` type definitions |
| `packages/browser/src/client/channel.ts` | BroadcastChannel event types (orchestrator ↔ tester iframes) |
| `packages/ui/client/composables/client/ws.ts` | birpc + WebSocket wiring to copy |
| `packages/ui/client/composables/client/state.ts` | StateManager pattern to copy |
