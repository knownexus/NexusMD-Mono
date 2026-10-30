import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// React components render under jsdom.
export default defineConfig({
  plugins: [react()],
  test: {
    name: 'ui',
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.js'],
  },
})
