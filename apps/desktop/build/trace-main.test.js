// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { traceMainTree, traceMainPlugin } from './trace-main.mjs'

let dir
const put = (rel, text) => { mkdirSync(join(dir, rel, '..'), { recursive: true }); writeFileSync(join(dir, rel), text) }
const read = (rel) => readFileSync(join(dir, rel), 'utf8')
const FN = 'function f(a) { return a }\nmodule.exports = { f }'
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'nxt-main-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('traceMainTree (a staged copy of the main process)', () => {
  const stage = () => {
    put('stage/electron/main.cjs', FN)
    put('stage/electron/preload.cjs', FN)
    put('stage/electron/main.test.js', FN)
    put('stage/electron/data.json', '{"a":1}')
    put('stage/node_modules/@nexusmd/main-kit/src/safe-file.cjs', FN)
    put('stage/node_modules/@nexusmd/main-kit/src/logging/hub.cjs', FN)
    put('stage/node_modules/electron-log/index.js', FN)
    return join(dir, 'stage')
  }

  it('traces the shell and main-kit in place, with ids that name their place in the repository', () => {
    const s = stage()
    const { files, traced } = traceMainTree(s)
    expect(read('stage/electron/main.cjs')).toContain('"apps/desktop/electron/main.cjs:1:0:f"')
    expect(read('stage/node_modules/@nexusmd/main-kit/src/safe-file.cjs')).toContain('"packages/main-kit/src/safe-file.cjs:1:0:f"')
    expect(traced).toBe(2)
    expect(files).toBeGreaterThanOrEqual(2)
  })

  it('leaves the preload, tests, the logger, other packages and non-code files as they were', () => {
    const s = stage()
    traceMainTree(s)
    for (const rel of ['stage/electron/preload.cjs', 'stage/electron/main.test.js', 'stage/node_modules/@nexusmd/main-kit/src/logging/hub.cjs', 'stage/node_modules/electron-log/index.js']) {
      expect(read(rel), rel).toBe(FN)
    }
    expect(read('stage/electron/data.json')).toBe('{"a":1}')
  })

  it('writing to another folder copies and traces there, and never touches the source folder', () => {
    const s = stage()
    const out = join(dir, 'out')
    traceMainTree(s, out)
    expect(read('out/electron/main.cjs')).toContain('__nxt')
    expect(read('out/electron/data.json')).toBe('{"a":1}')
    expect(read('stage/electron/main.cjs')).toBe(FN)
    expect(existsSync(join(out, 'node_modules/electron-log/index.js'))).toBe(true)
  })
})

describe("traceMainPlugin (an app's main bundle)", () => {
  const repo = 'C:/repo'
  it("traces an app's main-process file and skips node_modules, the logger and window code", () => {
    const p = traceMainPlugin({ root: repo })
    expect(p.name).toBe('nexusmd-trace-main')
    expect(p.transform(FN, 'C:/repo/modules/git/src/main/git-actions.cjs').code).toContain('__nxt.enter(')
    expect(p.transform(FN, 'C:/repo/node_modules/x/index.js')).toBeNull()
    expect(p.transform(FN, 'C:/repo/packages/main-kit/src/logging/hub.cjs')).toBeNull()
    expect(p.transform(FN, 'C:/repo/modules/git/src/renderer/a.jsx')).toBeNull()
  })
})
