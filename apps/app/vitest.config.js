import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { isolation, isolationSetup } from '../../vitest.shared.js'

export default defineConfig({
  plugins: [react()],
  test: {
    name: 'app',
    environment: 'jsdom',
    setupFiles: [isolationSetup, './vitest.setup.js'],
    ...isolation,
    exclude: ['e2e/**', 'server/**', 'server-tests/**', '**/node_modules/**'],
  },
})
