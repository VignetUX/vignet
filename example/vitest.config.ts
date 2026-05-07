import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { workshopPlugin } from '../src/plugin/index.js'
import { preview } from '@vitest/browser-preview'

export default defineConfig({
  plugins: [react(), workshopPlugin()],
  test: {
    browser: {
      enabled: true,
      provider: preview(),
      instances: [{ browser: 'chromium' }],
    },
    include: ['src/**/*.workshop.{ts,tsx}'],
  },
})
