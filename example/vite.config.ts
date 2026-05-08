import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { workshopPlugin } from '../src/plugin.ts'

export default defineConfig({
  plugins: [react(), workshopPlugin({ include: 'src/**/*.test.{ts,tsx}' })],
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        frame: 'frame.html',
      },
    },
  },
})
