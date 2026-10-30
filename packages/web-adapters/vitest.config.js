import { defineConfig } from 'vitest/config'
import { isolation, isolationSetup } from '../../vitest.shared.js'

// Browser adapters touch window/localStorage/navigator — run under jsdom.
export default defineConfig({
  test: {
    name: 'web-adapters',
    environment: 'jsdom',
    setupFiles: [isolationSetup, './tests/setup.js'],
    ...isolation,
  },
})
