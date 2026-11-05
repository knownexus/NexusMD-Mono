// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { installTraceHook } = require('./trace-hook.cjs')
const nxt = require('@nexusmd/trace/runtime')
const { instrument } = await import('@nexusmd/trace/instrument')

let dir, uninstall
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nxt-hook-'))
  mkdirSync(join(dir, 'traced')); mkdirSync(join(dir, 'plain'))
  writeFileSync(join(dir, 'traced', 'a.cjs'), 'module.exports = { add(a, b) { return a + b } }')
  writeFileSync(join(dir, 'plain', 'b.cjs'), 'module.exports = { add(a, b) { return a + b } }')
  nxt.start({ proc: 'main' }); nxt.stop(); nxt.drain()
})
afterEach(() => { uninstall?.(); nxt.stop(); nxt.drain(); rmSync(dir, { recursive: true, force: true }) })

const events = () => nxt.drain().filter(e => e.k === 'enter')
// The hook decides by path whether a file is main-process code; here every file under traced/ is.
const options = (over = {}) => ({ root: dir, instrument, shouldTrace: (rel) => rel.startsWith('traced/'), ...over })

describe('installTraceHook', () => {
  it('runs a file the rule accepts traced, and any other file untouched', () => {
    uninstall = installTraceHook(options())
    nxt.start({ proc: 'main' })
    expect(require(join(dir, 'traced', 'a.cjs')).add(1, 2)).toBe(3)
    expect(require(join(dir, 'plain', 'b.cjs')).add(1, 2)).toBe(3)
    const enters = events()
    expect(enters).toHaveLength(1)
    expect(enters[0].fn).toBe('traced/a.cjs:1:19:add')
    expect(enters[0].a).toEqual([1, 2])
  })

  it('uninstall restores plain loading', () => {
    uninstall = installTraceHook(options())
    uninstall(); uninstall = undefined
    writeFileSync(join(dir, 'traced', 'c.cjs'), 'module.exports = { add(a, b) { return a + b } }')
    nxt.start({ proc: 'main' })
    require(join(dir, 'traced', 'c.cjs')).add(1, 2)
    expect(events()).toHaveLength(0)
  })

  it('a file with a syntax error still fails with its own error, not ours', () => {
    writeFileSync(join(dir, 'traced', 'bad.cjs'), 'module.exports = { ok: 1 }; function (')
    uninstall = installTraceHook(options())
    expect(() => require(join(dir, 'traced', 'bad.cjs'))).toThrow(SyntaxError)
  })

  it('a transform that throws falls back to loading the file plain', () => {
    uninstall = installTraceHook(options({ instrument: () => { throw new Error('transform broke') } }))
    writeFileSync(join(dir, 'traced', 'd.cjs'), 'module.exports = { n: 4 }')
    expect(require(join(dir, 'traced', 'd.cjs')).n).toBe(4)
  })
})
