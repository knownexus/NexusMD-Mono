import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['electron/**/*.test.{js,cjs}'],
    exclude: ['e2e/**', 'node_modules/**'],
    environment: 'node',
  },
})
