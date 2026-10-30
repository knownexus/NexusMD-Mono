import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    name: 'work',
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.js'],
  },
})
