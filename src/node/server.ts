import { createServer, type ViteDevServer } from 'vite'
import { fileURLToPath } from 'url'
import { join, sep, isAbsolute, relative, extname } from 'path'
import { readdirSync, readFileSync } from 'node:fs'
import { workshopPlugin, getMockerPlugins } from '../plugin.js'
import { frameHtml, workshopHtml } from './templates.js'
import { loadConsumerPluginsAndResolve } from './consumer-config.js'
import { resolveFrameworkAdapterEnv } from './adapters/index.js'

const vignetDir = fileURLToPath(new URL('../', import.meta.url))

// Pre-built UI shell (see scripts/build-ui.ts) — served as static files below rather
// than live-transformed via /@fs/, so consumers never need @vitejs/plugin-react/react/react-dom.
const uiDevDir = join(vignetDir, 'dist/ui-dev')
const UI_STATIC_MIME: Record<string, string> = {
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}

export async function startVignetServer(vitest: any): Promise<void> {
  const rawDir: string | undefined = vitest?.config?.dir
  const rawInclude: string | string[] | undefined = vitest?.config?.include
  const rawSetupFiles: string | string[] | undefined = vitest?.config?.setupFiles

  // vitest.config.setupFiles is already the fully-resolved absolute-path list vitest
  // itself would import before running tests. Convert to the /@fs/ convention frameHtml
  // already uses so frame.ts can import() them the same way it imports the test file.
  const setupFileUrls = (Array.isArray(rawSetupFiles) ? rawSetupFiles : rawSetupFiles ? [rawSetupFiles] : []).map(
    f => `/@fs${f}`,
  )

  // Tier 2: frameworks whose test bootstrapping can't be expressed as "a list of files to
  // import" (Angular's TestBed.initTestEnvironment()) contribute extra setup files on top of
  // the generic Tier 1 list above. Resolved once at server startup, same as everything else here.
  const adapterEnv = await resolveFrameworkAdapterEnv(process.cwd())
  const allSetupFileUrls = [...setupFileUrls, ...adapterEnv.setupFiles]

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

  const frameEntry = join(vignetDir, 'src/frame.ts')

  const mockerPlugins = await getMockerPlugins()
  // Pass the exact config file vitest itself resolved (it already prefers vitest.config.*
  // over vite.config.*), so vignet picks up aliases/plugins defined there even when the
  // consumer has no vite.config.ts at all (common for Next.js apps).
  const { plugins: consumerPlugins, resolve: consumerResolve } = await loadConsumerPluginsAndResolve(
    process.cwd(),
    vitest?.vite?.config?.configFile,
  )

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
      // vignetDir must be allowed so /@fs/ can serve frame.ts from vignet's src/
      fs: { allow: [process.cwd(), vignetDir] },
    },
    // frame.ts is served via /@fs/ from outside the consumer's Vite root, so Vite's dep
    // scanner never crawls it. Without entries, CJS packages it imports are only discovered
    // lazily on the first browser request — too late to pre-bundle before the browser loads,
    // causing a fatal SyntaxError on the consumer's first run. entries scans it upfront.
    // The UI shell (main.tsx) is pre-built (see scripts/build-ui.ts) and served as a static
    // file, so it needs no entry here.
    optimizeDeps: {
      entries: [frameEntry],
    },
    // consumerPlugins first so their resolveId/transform hooks run before vignet's shim.
    // This ensures vite-tsconfig-paths and similar plugins resolve imports correctly.
    plugins: [
      ...consumerPlugins,
      ...adapterEnv.plugins,
      workshopPlugin({ include: consumerInclude }),
      ...mockerPlugins,
      vignetServerPlugin(frameEntry, allSetupFileUrls),
    ],
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
function vignetServerPlugin(frameEntry: string, setupFileUrls: string[]) {
  return {
    name: 'vignet:server',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req: any, res: any, next: () => void) => {
        if (req.url === '/__workshop_env__') {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ setupFiles: setupFileUrls }))
          return
        }
        if (req.url?.startsWith('/__vignet_ui__/')) {
          const fileName = decodeURIComponent(req.url.slice('/__vignet_ui__/'.length).split('?')[0])
          const filePath = join(uiDevDir, fileName)
          if (fileName.includes('..') || !filePath.startsWith(uiDevDir + sep)) {
            res.writeHead(403)
            res.end()
            return
          }
          try {
            const content = readFileSync(filePath)
            const type = UI_STATIC_MIME[extname(fileName)] ?? 'application/octet-stream'
            res.writeHead(200, { 'Content-Type': type })
            res.end(content)
          } catch {
            res.writeHead(404)
            res.end()
          }
          return
        }
        if (req.url?.startsWith('/frame')) {
          const html = await server.transformIndexHtml('/frame', frameHtml(frameEntry))
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(html)
          return
        }
        if (req.url !== '/') { next(); return }
        const uiCssFile = readdirSync(uiDevDir).find(f => f.endsWith('.css'))
        const html = await server.transformIndexHtml(
          '/',
          workshopHtml('/__vignet_ui__/workshop.js', uiCssFile && `/__vignet_ui__/${uiCssFile}`),
        )
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(html)
      })
    },
  }
}
