import { createServer, loadConfigFromFile, type ViteDevServer } from 'vite'
import { fileURLToPath } from 'url'
import { join, sep, isAbsolute, relative } from 'path'
import { workshopPlugin, getMockerPlugins } from '../plugin.js'
import { frameHtml, workshopHtml } from './templates.js'

const vignetDir = fileURLToPath(new URL('../', import.meta.url))

// Load the consumer's vite.config.ts and return only the parts that are safe to forward:
// plugins (e.g. vite-tsconfig-paths, custom resolvers) and resolve config (aliases).
// We deliberately do NOT forward server, base, appType, build, etc. — those settings
// control how the consumer's app is served and would break vignet's own server if inherited.
async function loadConsumerPluginsAndResolve(root: string): Promise<{ plugins: any[]; resolve: any }> {
  try {
    const result = await loadConfigFromFile({ command: 'serve', mode: 'development' }, undefined, root)
    return {
      // Flatten in case any plugin entry is itself an array (Vite allows nested plugin arrays)
      plugins: (result?.config?.plugins ?? []).flat().filter(Boolean),
      resolve: result?.config?.resolve ?? {},
    }
  } catch {
    return { plugins: [], resolve: {} }
  }
}

export async function startVignetServer(vitest: any): Promise<void> {
  const rawDir: string | undefined = vitest?.config?.dir
  const rawInclude: string | string[] | undefined = vitest?.config?.include

  // vitest.config.include patterns are relative to vitest.config.dir, not the project root.
  // Prepend dir so the glob in workshopPlugin resolves correctly from process.cwd().
  let consumerInclude: string | string[] | undefined
  if (rawInclude) {
    if (rawDir) {
      const relDir = isAbsolute(rawDir)
        ? relative(process.cwd(), rawDir)
        : rawDir.replace(/^\.\//, '')
      const patterns = Array.isArray(rawInclude) ? rawInclude : [rawInclude]
      consumerInclude = patterns.map(p => join(relDir, p).replaceAll(sep, '/'))
    } else {
      consumerInclude = rawInclude
    }
  }

  const mainEntry = join(vignetDir, 'src/ui/main.tsx')
  const frameEntry = join(vignetDir, 'src/frame.ts')

  const mockerPlugins = await getMockerPlugins()
  const { plugins: consumerPlugins, resolve: consumerResolve } = await loadConsumerPluginsAndResolve(process.cwd())

  const server = await createServer({
    configFile: false,
    // Disables Vite's SPA fallback — vignet controls all routes via vignetServerPlugin.
    appType: 'custom',
    root: process.cwd(),
    // Forward only resolve config from the consumer (aliases, mainFields, etc.).
    // Plugin-provided aliases (e.g. vite-tsconfig-paths) come via consumerPlugins below.
    ...(Object.keys(consumerResolve).length && { resolve: consumerResolve }),
    server: {
      open: '/',
      // vignetDir must be allowed so /@fs/ can serve main.tsx and frame.ts from vignet's src/
      fs: { allow: [process.cwd(), vignetDir] },
    },
    // main.tsx and frame.ts are served via /@fs/ from outside the consumer's Vite root,
    // so Vite's dep scanner never crawls them. Without entries, CJS packages they import
    // (e.g. react-dom/client) are only discovered lazily on the first browser request —
    // too late to pre-bundle before the browser loads, causing a fatal SyntaxError on
    // the consumer's first run. entries tells Vite to scan these files upfront at startup.
    optimizeDeps: {
      entries: [mainEntry, frameEntry],
    },
    // consumerPlugins first so their resolveId/transform hooks run before vignet's shim.
    // This ensures vite-tsconfig-paths and similar plugins resolve imports correctly.
    plugins: [...consumerPlugins, workshopPlugin({ include: consumerInclude }), ...mockerPlugins, vignetServerPlugin(mainEntry, frameEntry, vitest)],
  })

  await server.listen()
  server.printUrls()
}

/**
 * This plugin wrapper is required for correct middleware ordering:
 * by the time `createServer()` returns, Vite has already registered
 * its internal middleware (including the SPA HTML fallback).
 * A plugin's `configureServer` hook runs *before* that registration, so
 * vignet's middleware intercepts requests first. Adding to `server.middlewares`
 * after `createServer()` returns would place the handler after Vite's fallback.
 * This is the same pattern Vitest uses in its browser plugin
 * (`packages/browser/src/node/plugin.ts`).
 */
function vignetServerPlugin(mainEntry: string, frameEntry: string, _vitest: unknown) {
  return {
    name: 'vignet:server',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req: any, res: any, next: () => void) => {
        if (req.url?.startsWith('/frame')) {
          const html = await server.transformIndexHtml('/frame', frameHtml(frameEntry))
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(html)
          return
        }
        if (req.url !== '/') { next(); return }
        const html = await server.transformIndexHtml('/', workshopHtml(mainEntry))
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(html)
      })
    },
  }
}
