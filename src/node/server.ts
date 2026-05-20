import { createServer, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'url'
import { join } from 'path'
import { workshopPlugin, getMockerPlugins } from '../plugin.js'

const jibeDir = fileURLToPath(new URL('../', import.meta.url))

export async function startJibeServer(vitest: unknown): Promise<void> {
  const mockerPlugins = await getMockerPlugins()
  const server = await createServer({
    configFile: false,
    // Disables Vite's SPA fallback so that test memoryroutes etc are disabled. Jibe only exposes specific routes.
    appType: 'custom',
    root: process.cwd(),
    server: {
      open: '/',
      fs: { allow: [process.cwd(), jibeDir] },
    },
    plugins: [react(), workshopPlugin(), ...mockerPlugins, jibeServerPlugin(vitest)],
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
function jibeServerPlugin(_vitest: unknown) {
  const mainEntry = join(jibeDir, 'src/ui/main.tsx')
  const frameEntry = join(jibeDir, 'src/frame.ts')
  return {
    name: 'jibe:server',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req: any, res: any, next: () => void) => {
        if (req.url?.startsWith('/frame')) {
          const raw = `<!DOCTYPE html>
<html lang="en">
  <head><meta charset="UTF-8" /><title>Jibe Frame</title></head>
  <body><script type="module" src="/@fs${frameEntry}"></script></body>
</html>`
          const html = await server.transformIndexHtml('/frame', raw)
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(html)
          return
        }
        if (req.url !== '/') { next(); return }
        const raw = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Jibe Workshop</title>
  </head>
  <body>
    <div id="root"></div>
    <script>
      // dynamicImportPlugin wraps all import() calls with __vitest_mocker__.wrapDynamicImport.
      // The mocker is only active in the test iframe, so provide a passthrough here.
      if (!window["__vitest_mocker__"]) window["__vitest_mocker__"] = { wrapDynamicImport: fn => fn() };
    </script>
    <script type="module" src="/@fs${mainEntry}"></script>
  </body>
</html>`
        const html = await server.transformIndexHtml('/', raw)
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(html)
      })
    },
  }
}
