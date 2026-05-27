import { createServer, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'url'
import { pathToFileURL } from 'node:url'
import { join, sep, isAbsolute, relative, resolve as resolvePath } from 'path'
import { createRequire } from 'module'
import { workshopPlugin, getMockerPlugins } from '../plugin.js'

// Try to resolve vite-tsconfig-paths from the consumer's project.
// Many TypeScript projects (Next.js, etc.) declare path aliases only in tsconfig.json and rely
// on this plugin to make Vite aware of them; those aliases never appear in resolve.alias.
async function getTsconfigPathsPlugin(): Promise<any[]> {
  try {
    const consumerRequire = createRequire(resolvePath(process.cwd(), 'package.json'))
    const pluginPath = consumerRequire.resolve('vite-tsconfig-paths')
    const mod = await import(pathToFileURL(pluginPath).href)
    const factory = mod.default ?? mod
    return [factory()]
  } catch {
    return []
  }
}

const jibeDir = fileURLToPath(new URL('../', import.meta.url))

export async function startJibeServer(vitest: any): Promise<void> {
  const allAliases: any[] = vitest?.vite?.config?.resolve?.alias ?? []
  const consumerAlias = allAliases.filter(a => {
    if (typeof a.find === 'string') return !a.find.includes('@vite/')
    // .source preserves backslash-escaping (e.g. @vite\/ ≠ @vite/) so use .test() instead
    const re = a.find as RegExp
    return !re.test('@vite/client') && !re.test('@vite/env')
  })
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

  const mockerPlugins = await getMockerPlugins()
  const tsconfigPathsPlugins = await getTsconfigPathsPlugin()
  const server = await createServer({
    configFile: false,
    // Disables Vite's SPA fallback so that test memoryroutes etc are disabled. Jibe only exposes specific routes.
    appType: 'custom',
    root: process.cwd(),
    ...(consumerAlias?.length && { resolve: { alias: consumerAlias } }),
    server: {
      open: '/',
      fs: { allow: [process.cwd(), jibeDir] },
    },
    plugins: [react(), workshopPlugin({ include: consumerInclude }), ...tsconfigPathsPlugins, ...mockerPlugins, jibeServerPlugin(vitest)],
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
