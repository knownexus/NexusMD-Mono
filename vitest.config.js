import { defineConfig } from 'vitest/config'

// Root config — `npm test` (vitest run) runs every package's suite with its own
// vitest.config.js (Vitest 4 dropped vitest.workspace.js).
export default defineConfig({
  test: {
    projects: [
      'packages/core',
      'packages/web-adapters',
      'packages/ui',
      'apps/desktop',
    ],
  },
})
