import { defineConfig } from 'vitest/config'

// Browser adapters touch window/localStorage/navigator — run under jsdom.
export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.js'],
  },
})
