// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// The call reports are added to the desktop builds only. The web app and the Android app build the same shared
// packages (core, ui) and must get none of it.
const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..', '..', '..')
const read = (p) => readFileSync(join(repo, p), 'utf8')

describe('call tracing reaches the desktop builds only', () => {
  it.each(['apps/desktop/vite.config.js', 'apps/desktop/vite.split.config.js', 'apps/desktop/build/build-split.mjs'])('%s uses traceCalls', (file) => {
    expect(read(file)).toMatch(/traceCalls\(/)
  })

  it.each(['apps/web/vite.config.js', 'apps/app/vite.config.js'])('%s does not', (file) => {
    expect(read(file)).not.toMatch(/traceCalls|@nexusmd\/trace/)
  })

  // packages/core/src/log.js (and the window recorder beside it) read globalThis.__nxt when something put it there; that is
  // not a call report. What must never appear is the report itself, or an import of the trace package.
  it('no web or Android source imports the trace package or contains a call report', () => {
    const offenders = []
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        if (['node_modules', 'dist', 'android', 'wwwroot', '.git'].includes(name)) continue
        const p = join(dir, name)
        if (statSync(p).isDirectory()) walk(p)
        else if (/\.(jsx?|mjs|cjs|html)$/.test(name) && /__nxt\.enter\(|@nexusmd\/trace/.test(readFileSync(p, 'utf8'))) offenders.push(p)
      }
    }
    for (const dir of ['apps/web', 'apps/app', 'packages/core', 'packages/ui', 'packages/web-adapters', 'packages/shell-sdk', 'packages/editor-kit']) {
      if (existsSync(join(repo, dir))) walk(join(repo, dir))
    }
    expect(offenders).toEqual([])
  })

  it('a built web or app bundle, when one exists, has no call reports', () => {
    for (const dir of ['dist/web', 'dist/app', 'apps/web/dist', 'apps/app/dist']) {
      const assets = join(repo, dir, 'assets')
      if (!existsSync(assets)) continue
      for (const f of readdirSync(assets).filter(n => n.endsWith('.js'))) {
        // A call report's id names a source file, line and column, and survives minifying.
        expect(readFileSync(join(assets, f), 'utf8'), `${dir}/assets/${f}`).not.toMatch(/(?:packages|apps|modules)\/[\w/.-]+\.jsx?:\d+:\d+:\w*/)
      }
    }
  })
})
