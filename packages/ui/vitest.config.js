import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { isolation, isolationSetup } from '../../vitest.shared.js'

// React components render under jsdom.
export default defineConfig({
  plugins: [react()],
  test: {
    name: 'ui',
    environment: 'jsdom',
    setupFiles: [isolationSetup, './vitest.setup.js'],
    ...isolation,
  },
})
