import { defineConfig } from 'vitest/config'
import { isolation, isolationSetup } from '../../vitest.shared.js'

// Node-only helpers (file safety, logging wrapper).
export default defineConfig({
  test: { name: 'main-kit', environment: 'node', setupFiles: [isolationSetup], ...isolation },
})
