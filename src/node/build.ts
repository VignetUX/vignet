import { build as viteBuild } from 'vite'
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path, { resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { workshopPlugin, discoverWorkshopFiles, getHoistMocksPlugin } from '../plugin.js'
import { buildMockPlugin } from './build-plugin.js'
import { workshopBuildHtml, frameBuildHtml } from './templates.js'

const jibeDir = fileURLToPath(new URL('../', import.meta.url))

function shortHash(str: string): string {
  return createHash('md5').update(str).digest('hex').slice(0, 8)
}

function extractViewNames(filePath: string): string[] {
  const content = readFileSync(filePath, 'utf-8')
  const names: string[] = []
  const re = /meta\s*:\s*\{[^}]*jibe\s*:\s*\{[^}]*name\s*:\s*['"`]([^'"`]+)['"`]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) names.push(m[1])
  return names
}

export async function buildWorkshop(root: string, outDir: string): Promise<void> {
  const include = 'src/**/*.test.{ts,tsx}'
  const absOutDir = resolve(root, outDir)

  console.log(`[jibe] Building workshop to ${absOutDir}`)

  const files = await discoverWorkshopFiles(root, include)
  if (files.length === 0) {
    console.warn('[jibe] No workshop files found (no files with jibe: marker match the include pattern).')
  }

  // 1. Build the UI shell as an ES module library.
  //    define: { __JIBE_BUILD_MODE__: 'true' } inlines the build-mode flag so App.tsx
  //    fetches manifest.json instead of /__workshop_files__.
  const uiEntry = resolve(jibeDir, 'src/ui/main.tsx')
  await viteBuild({
    configFile: false,
    root: jibeDir,
    plugins: [react(), workshopPlugin({ buildMode: true })],
    define: {
      __JIBE_BUILD_MODE__: 'true',
      // Vite's library mode does not auto-replace process.env.NODE_ENV the way app mode does.
      // React checks this at runtime to choose its dev vs production bundle; without this
      // define the reference survives into the output and throws in browsers (no process global).
      'process.env.NODE_ENV': '"production"',
    },
    build: {
      outDir: absOutDir,
      emptyOutDir: true,
      lib: {
        entry: uiEntry,
        formats: ['es'],
        fileName: () => 'ui.js',
      },
    },
    server: { fs: { allow: [root, jibeDir] } },
  })
  writeFileSync(path.join(absOutDir, 'index.html'), workshopBuildHtml('./ui.js'))

  // 2. Build the static frame runtime (frame-static.ts → frame.js).
  const frameStaticEntry = resolve(jibeDir, 'src/frame-static.ts')
  await viteBuild({
    configFile: false,
    root: jibeDir,
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

  const manifest: Array<{ path: string; bundle: string; views: string[] }> = []

  for (const file of files) {
    const hash = shortHash(file)
    const bundleFile = `${hash}.js`

    await viteBuild({
      configFile: false,
      root,
      plugins: [workshopPlugin({ buildMode: true }), ...extraPlugins, buildMockPlugin()],
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
      server: { fs: { allow: [root, jibeDir] } },
    })

    manifest.push({
      path: '/' + relative(root, file).replaceAll(path.sep, '/'),
      bundle: bundleFile,
      views: extractViewNames(file),
    })

    console.log(`[jibe] Built ${relative(root, file)} → tests/${bundleFile}`)
  }

  writeFileSync(
    path.join(absOutDir, 'manifest.json'),
    JSON.stringify({ files: manifest }, null, 2),
  )

  console.log(`[jibe] Done. ${manifest.length} file(s) built. Output: ${absOutDir}`)
}
