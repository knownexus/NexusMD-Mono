import { defineConfig } from 'vitest/config'

// Node-only helpers (file safety, logging wrapper).
export default defineConfig({
  test: { environment: 'node' },
})
