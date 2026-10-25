import { defineConfig } from 'vitest/config'

// Pure logic only — no DOM needed.
export default defineConfig({
  test: { environment: 'node' },
})
