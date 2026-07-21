import { build as viteBuild } from 'vite'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync } from 'node:fs'
import path, { resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { workshopPlugin, discoverWorkshopFiles, getHoistMocksPlugin } from '../plugin.js'
import { buildMockPlugin } from './build-plugin.js'
import { workshopBuildHtml, frameBuildHtml } from './templates.js'
import { loadConsumerPluginsAndResolve, findConsumerConfigFile } from './consumer-config.js'

const vignetDir = fileURLToPath(new URL('../', import.meta.url))

function shortHash(str: string): string {
  return createHash('md5').update(str).digest('hex').slice(0, 8)
}

function extractViewNames(filePath: string): string[] {
  const content = readFileSync(filePath, 'utf-8')
  const names: string[] = []
  const re = /meta\s*:\s*\{[^}]*vignet\s*:\s*\{[^}]*name\s*:\s*['"`]([^'"`]+)['"`]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) names.push(m[1])
  return names
}

export async function buildWorkshop(root: string, outDir: string): Promise<void> {
  const include = 'src/**/*.test.{ts,tsx}'
  const absOutDir = resolve(root, outDir)

  console.log(`[vignet] Building workshop to ${absOutDir}`)

  const files = await discoverWorkshopFiles(root, include)
  if (files.length === 0) {
    console.warn('[vignet] No workshop files found (no files with vignet: marker match the include pattern).')
  }

  // 1. Copy the pre-built UI shell (ui.js + CSS/assets). Built once during vignet's own
  //    `npm run build` (see scripts/build-ui.ts) using vignet's own devDependencies
  //    (@vitejs/plugin-react, react, react-dom) so these aren't requirements for consumers.
  const uiBuildDir = resolve(vignetDir, 'dist/ui-build')
  if (!existsSync(uiBuildDir)) {
    throw new Error(
      `[vignet] Missing prebuilt UI shell at ${uiBuildDir}. Run "pnpm build" (or "tsx scripts/build-ui.ts") ` +
      'in the vignet package before running "vignet build".',
    )
  }
  rmSync(absOutDir, { recursive: true, force: true })
  mkdirSync(absOutDir, { recursive: true })
  cpSync(uiBuildDir, absOutDir, { recursive: true })
  writeFileSync(path.join(absOutDir, 'index.html'), workshopBuildHtml('./ui.js', './vignet.css'))

  // 2. Build the static frame runtime (frame-static.ts → frame.js).
  const frameStaticEntry = resolve(vignetDir, 'src/frame-static.ts')
  await viteBuild({
    configFile: false,
    root: vignetDir,
    plugins: [workshopPlugin({ buildMode: true })],
    build: {
      outDir: absOutDir,
      emptyOutDir: false,
      lib: {
        entry: frameStaticEntry,
        formats: ['es'],
        fileName: () => 'frame.js',
      },
    },
  })
  writeFileSync(path.join(absOutDir, 'frame.html'), frameBuildHtml('./frame.js'))

  // 3. Build each test file as an isolated self-contained ES module bundle.
  mkdirSync(path.join(absOutDir, 'tests'), { recursive: true })

  const hoistPlugin = await getHoistMocksPlugin()
  const extraPlugins = hoistPlugin ? [hoistPlugin] : []

  // Consumer plugins (e.g. vite-tsconfig-paths) and resolve config (aliases) are needed here
  // because these test files import the consumer's own components. There's no live Vitest
  // instance to ask (unlike the dev server), so probe for vitest.config.*/vite.config.* directly.
  const configFile = findConsumerConfigFile(root)
  const { plugins: consumerPlugins, resolve: consumerResolve } = await loadConsumerPluginsAndResolve(root, configFile)

  const manifest: Array<{ path: string; bundle: string; views: string[] }> = []

  for (const file of files) {
    const hash = shortHash(file)
    const bundleFile = `${hash}.js`

    await viteBuild({
      configFile: false,
      root,
      ...(Object.keys(consumerResolve).length && { resolve: consumerResolve }),
      plugins: [...consumerPlugins, workshopPlugin({ buildMode: true }), ...extraPlugins, buildMockPlugin()],
      build: {
        // esnext target is required: consumer dependencies may use top-level await
        // (e.g. react-router, @mui), which ES2020 esbuild doesn't support.
        target: 'esnext',
        outDir: path.join(absOutDir, 'tests'),
        emptyOutDir: false,
        lib: {
          entry: file,
          formats: ['es'],
          fileName: () => bundleFile,
        },
      },
      server: { fs: { allow: [root, vignetDir] } },
    })

    manifest.push({
      path: '/' + relative(root, file).replaceAll(path.sep, '/'),
      bundle: bundleFile,
      views: extractViewNames(file),
    })

    console.log(`[vignet] Built ${relative(root, file)} → tests/${bundleFile}`)
  }

  writeFileSync(
    path.join(absOutDir, 'manifest.json'),
    JSON.stringify({ files: manifest }, null, 2),
  )

  console.log(`[vignet] Done. ${manifest.length} file(s) built. Output: ${absOutDir}`)
}
