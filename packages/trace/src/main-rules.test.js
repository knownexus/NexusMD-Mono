// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { shouldTraceMain, sourcePathOf } = require('./main-rules.cjs')

describe('shouldTraceMain (paths relative to the repository root)', () => {
  it("traces the shell, the shared main-process kit and each app's main-process code", () => {
    for (const p of ['apps/desktop/electron/main.cjs', 'apps/desktop/electron/ipc/logs.cjs', 'packages/main-kit/src/safe-file.cjs', 'modules/git/src/main/git-actions.cjs', 'modules/devenv/src/main/index.cjs']) {
      expect(shouldTraceMain(p), p).toBe(true)
    }
  })

  it('never traces the logger, the recorder, the trace package, the preload, the hook or code that runs in a sandbox', () => {
    for (const p of [
      'packages/main-kit/src/logging/hub.cjs', 'packages/main-kit/src/trace/recorder.cjs', 'packages/trace/src/runtime.js',
      'apps/desktop/electron/preload.cjs', 'apps/desktop/electron/trace-hook.cjs', 'apps/desktop/electron/ipc/recordings.cjs',
      'modules/api-client/src/main/bruno-prelude.sandbox.js',
    ]) expect(shouldTraceMain(p), p).toBe(false)
  })

  it('leaves tests, other packages and anything in node_modules alone', () => {
    for (const p of ['apps/desktop/electron/main.test.js', 'modules/git/src/main/x.integration.test.js', 'packages/core/src/a.js', 'modules/git/src/renderer/a.jsx', 'node_modules/electron-log/index.js', 'apps/desktop/electron/node_modules/x/a.cjs']) {
      expect(shouldTraceMain(p), p).toBe(false)
    }
  })

  it('only .js and .cjs files', () => {
    expect(shouldTraceMain('apps/desktop/electron/x.json')).toBe(false)
    expect(shouldTraceMain('apps/desktop/electron/x.cjs')).toBe(true)
  })
})

describe('sourcePathOf (a staged path becomes where the file lives in the repository)', () => {
  it('maps the staged shell and main-kit back to their source paths, and anything else to null', () => {
    expect(sourcePathOf('electron/main.cjs')).toBe('apps/desktop/electron/main.cjs')
    expect(sourcePathOf('node_modules/@nexusmd/main-kit/src/safe-file.cjs')).toBe('packages/main-kit/src/safe-file.cjs')
    expect(sourcePathOf('node_modules/electron-log/index.js')).toBeNull()
    expect(sourcePathOf('assets/icon.png')).toBeNull()
  })
})
