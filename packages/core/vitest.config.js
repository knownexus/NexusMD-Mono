import { defineConfig } from 'vitest/config'
import { isolation, isolationSetup } from '../../vitest.shared.js'

export default defineConfig({
  test: {
    name: 'core',
    environment: 'node',
    setupFiles: [isolationSetup],
    ...isolation,
  },
})
