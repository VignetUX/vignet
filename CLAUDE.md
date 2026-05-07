# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **Storybook-style component workshop** built on top of Vitest's browser mode. The core idea: a "story" is a Vitest test file that renders a component instead of asserting. The custom orchestrator UI replaces Vitest's default `@vitest/ui` dashboard and provides variant picker. In the future, we will provide prop knobs, and viewport resizer controls.

## Architecture

**Chosen approach: Vite dev server + custom orchestrator UI.** A fully static approach was rejected due to the cost of surgically removing Vitest's `birpc` WebSocket layer and reimplementing mock resolution at build time.

### Key components to build

1. **Vite middleware plugin** — intercepts `/__vitest_test__/` and serves custom orchestrator HTML instead of Vitest's built-in orchestrator. There is no config option for this; a plugin is required.

2. **Custom orchestrator UI** — connects to Vitest over WebSocket at `/__vitest_browser_api__?type=orchestrator&rpcId={uuid}` using `birpc` with the `flatted` serializer. Subscribes to `onCollected`, `onTaskUpdate`, `onQueued`, `onFinished`, `onUserConsoleLog` events; triggers execution via `createTesters({ files: [...] })`.

3. **Custom tester HTML** (optional) — configured via `testerHtmlPath` in `vitest.config.ts`. This is the iframe where components actually render. Use it to inject design tokens, global CSS, or wrapper layout divs.

4. **Story file convention** — files matching `*.workshop.ts`. Each story calls a `workshopMount()` helper that renders and holds the component in the iframe. Each `test()` call = one variant.

5. **Prop knobs / viewport re-runs** — viewport changes via `triggerCommand(sessionId, 'setViewport', ...)`. Props via URL params on the tester iframe URL; re-run via `createTesters({ files: [currentFile] })`.

### Key Vitest internals (reference files in the Vitest source)

| File | Purpose |
|---|---|
| `packages/browser/src/node/middlewares/orchestratorMiddleware.ts` | The route the plugin intercepts |
| `packages/browser/src/node/serverOrchestrator.ts` | How existing orchestrator HTML is generated |
| `packages/browser/src/node/serverTester.ts` | How tester HTML is generated; `testerHtmlPath` handling |
| `packages/browser/src/node/rpc.ts` | Full WebSocket RPC handler — all message types |
| `packages/browser/src/types.ts` | `WebSocketBrowserHandlers` and `WebSocketBrowserEvents` types |
| `packages/browser/src/client/channel.ts` | BroadcastChannel event types (orchestrator ↔ tester iframes) |
| `packages/ui/client/composables/client/ws.ts` | birpc + WebSocket wiring to copy for the custom UI |
| `packages/ui/client/composables/client/state.ts` | StateManager pattern to copy for accumulating test results |

### Runtime topology

```
[User's browser]
    ↕ HTTP + WebSocket (sticky session required)
[Node process]
    ├─ Vite dev server  (serves + transforms component code)
    ├─ birpc WebSocket server at /__vitest_browser_api__
    └─ Chromium via Playwright (headless, renders the iframes)
         └─ Orchestrator page + component tester iframes
```

For cloud/SaaS: one ephemeral container (Node + Chromium) per session, killed after inactivity. Load balancer must use sticky sessions.

## Planned Directory Structure

Inferred from `.gitignore` entries:
- `test/fixtures/` — fixture projects for integration tests; each has its own `node_modules/`, `jibe-dist/`, and `workshop-dist/` (all gitignored)
