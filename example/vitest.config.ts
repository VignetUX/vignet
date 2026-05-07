import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { workshopPlugin } from '../src/plugin/index.js'
import { preview } from '@vitest/browser-preview';

export default defineConfig({
  plugins: [react(), workshopPlugin()],
  test: {
    browser: {
      enabled: true,
      headless: false,
      provider: preview(),
      instances: [{ browser: 'chromium' }],
      // workshopPlugin sets ui: false and isolate: false in configResolved,
      // but we also declare them here for clarity.
      ui: false,
      isolate: false,
    },
    include: ['src/**/*.workshop.{ts,tsx}'],
  },
})
