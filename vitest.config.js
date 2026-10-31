import { defineConfig, configDefaults } from 'vitest/config'

// Root config — `npm test` (vitest run) runs every package's suite with its own
// vitest.config.js (Vitest 4 dropped vitest.workspace.js). Each project has a
// `test.name`, so `vitest run --project <name>` runs one of them; the root
// `test:<feature>` scripts pair a module with its logic in packages/core.
//
// Git's *.integration.test.js files drive real repos in temp dirs and take far
// longer than the rest, so they are a project of their own: `git-integration`.
const GIT_INTEGRATION = '**/*.integration.test.js'

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
      'modules/time',
      'modules/devenv',
      {
        extends: './modules/git/vitest.config.js',
        test: { root: './modules/git', exclude: [...configDefaults.exclude, GIT_INTEGRATION] },
      },
      {
        extends: './modules/git/vitest.config.js',
        test: { name: 'git-integration', root: './modules/git', include: [GIT_INTEGRATION] },
      },
      'modules/planner',
      'modules/work',
      'packages/ui',
      'apps/desktop',
      'apps/web',
      'apps/app',
    ],
  },
})
