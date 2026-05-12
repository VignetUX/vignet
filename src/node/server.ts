import { createServer } from 'vite'
import type { Plugin } from 'vite'

export async function startJibeServer(): Promise<void> {
  const server = await createServer({
    root: process.cwd(),
    server: {
      open: '/',
    },
    plugins: [jibeServerPlugin()],
  })

  await server.listen()
  server.printUrls()
}

/**
 * This plugin wrapper is required for correct middleware ordering:
 * by the time `createServer()` returns, Vite has already registered
 * its internal middleware (including the SPA HTML fallback).
 * A plugin's `configureServer` hook runs *before* that registration, so
 * jibe's middleware intercepts requests first. Adding to `server.middlewares`
 * after `createServer()` returns would place the handler after Vite's fallback.
 * This is the same pattern Vitest uses in its browser plugin
 * (`packages/browser/src/node/plugin.ts`).
 */
function jibeServerPlugin(): Plugin {
  return {
    name: 'jibe:server',
    configureServer(server) {
      server.middlewares.use('/', (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Jibe Workshop</title>
  </head>
  <body>
    <h1>Jibe Workshop</h1>
    <p>Coming soon...</p>
  </body>
</html>`)
      })
    },
  }
}
