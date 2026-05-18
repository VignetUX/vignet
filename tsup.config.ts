import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/cli/cli.ts'],
  format: ['esm'],
  outDir: 'dist',
  target: 'node20',
  // Regex covers both 'vitest' and subpaths like 'vitest/node'.
  // All entries here are peer deps and must be resolved from the consumer's node_modules.
  external: [/^vitest/, /^vite/, /^@vitejs/, /^react/, /^react-dom/],
})
