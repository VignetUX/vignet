// Prebuilds vignet's own workshop UI shell (src/ui/main.tsx) into static JS/CSS bundles,
// run once during vignet's own `npm run build`. This uses @vitejs/plugin-react, react, and
// react-dom as vignet's own devDependencies — they never need to be installed by consumers,
// since the dev server and static build both serve/copy these prebuilt files instead of
// live-transforming JSX on the consumer's machine.
import { build as viteBuild } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { workshopPlugin } from '../src/plugin.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const uiEntry = resolve(root, 'src/ui/main.tsx')

async function buildVariant(outDir: string, buildMode: boolean, fileName: string, libName?: string): Promise<void> {
  await viteBuild({
    configFile: false,
    root,
    plugins: [react(), workshopPlugin({ buildMode })],
    define: {
      __VIGNET_BUILD_MODE__: String(buildMode),
      // Vite's library mode does not auto-replace process.env.NODE_ENV the way app mode does.
      // React checks this at runtime to choose its dev vs production bundle; without this
      // define the reference survives into the output and throws in browsers (no process global).
      'process.env.NODE_ENV': '"production"',
    },
    build: {
      outDir,
      emptyOutDir: true,
      lib: {
        entry: uiEntry,
        formats: ['es'],
        ...(libName && { name: libName }),
        fileName: () => fileName,
      },
    },
  })
}

// Dev-server variant: fetches the live /__workshop_files__ endpoint. Named explicitly
// (libName: 'workshop') so the emitted CSS file has a predictable name (workshop.css)
// that server.ts can reference directly.
await buildVariant(resolve(root, 'dist/ui-dev'), false, 'workshop.js', 'workshop')

// Static-build variant: fetches manifest.json instead. Matches the filename ('ui.js')
// that build.ts's output HTML has always referenced.
await buildVariant(resolve(root, 'dist/ui-build'), true, 'ui.js')

console.log('[vignet] Prebuilt UI shell → dist/ui-dev, dist/ui-build')
