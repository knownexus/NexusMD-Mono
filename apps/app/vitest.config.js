import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    name: 'app',
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.js'],
    exclude: ['e2e/**', 'server/**', 'server-tests/**', '**/node_modules/**'],
  },
})
