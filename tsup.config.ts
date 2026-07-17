import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/cli/cli.ts'],
  format: ['esm'],
  outDir: 'dist',
  target: 'node20',
  // Regex covers both 'vitest' and subpaths like 'vitest/node'.
  // Both are peer deps and must be resolved from the consumer's node_modules.
  // @vitejs/plugin-react, react, and react-dom are no longer imported at runtime —
  // vignet's UI shell is prebuilt (see scripts/build-ui.ts), so they're vignet's own
  // devDependencies only, not consumer requirements.
  external: [/^vitest/, /^vite/],
})
