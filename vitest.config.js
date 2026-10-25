import { defineConfig } from 'vitest/config'

// Root config — `npm test` (vitest run) runs every package's suite with its own
// vitest.config.js (Vitest 4 dropped vitest.workspace.js).
export default defineConfig({
  test: {
    projects: [
      'packages/core',
      'packages/web-adapters',
      'packages/shell-sdk',
      'packages/main-kit',
      'packages/editor-kit',
      'modules/api-client',
      'modules/calendar',
      'modules/database',
      'modules/documents',
      'modules/editor',
      'modules/notes',
      'modules/devenv',
      'modules/git',
      'modules/planner',
      'packages/ui',
      'apps/desktop',
      'apps/web',
      'apps/app',
    ],
  },
})
