import { defineConfig } from 'vitest/config'
import { isolation, isolationSetup } from '../../vitest.shared.js'

// Node-only: the runtime, the transform and the build plugin.
export default defineConfig({
  test: { name: 'trace', environment: 'node', setupFiles: [isolationSetup], ...isolation },
})
