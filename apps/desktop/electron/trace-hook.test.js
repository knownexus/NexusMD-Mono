// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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

describe('installTraceHook: the cache of changed files', () => {
  let cache
  beforeEach(() => { cache = mkdtempSync(join(tmpdir(), 'nxt-cache-')) })
  afterEach(() => rmSync(cache, { recursive: true, force: true }))
  const withCache = (over = {}) => options({ cacheDir: cache, signature: 'v1', ...over })
  const counting = () => { const calls = []; return { calls, instrument: (code, o) => { calls.push(o.filename); return instrument(code, o) } } }
  const load = (file) => { delete require.cache[file]; return require(file) }

  it('a file changed once is read back from the cache the next time, without changing it again, and still reports', () => {
    const first = counting()
    uninstall = installTraceHook(withCache({ instrument: first.instrument }))
    load(join(dir, 'traced', 'a.cjs')); uninstall()
    expect(first.calls).toHaveLength(1)

    const second = counting()
    uninstall = installTraceHook(withCache({ instrument: second.instrument }))
    nxt.start({ proc: 'main' })
    expect(load(join(dir, 'traced', 'a.cjs')).add(1, 2)).toBe(3)
    expect(second.calls).toHaveLength(0)
    expect(events()).toHaveLength(1)
  })

  it('a file that nothing needed changing in is remembered too', () => {
    writeFileSync(join(dir, 'traced', 'plain-data.cjs'), 'module.exports = { n: 1 }')
    const first = counting()
    uninstall = installTraceHook(withCache({ instrument: first.instrument }))
    load(join(dir, 'traced', 'plain-data.cjs')); uninstall()
    const second = counting()
    uninstall = installTraceHook(withCache({ instrument: second.instrument }))
    expect(load(join(dir, 'traced', 'plain-data.cjs')).n).toBe(1)
    expect(first.calls).toHaveLength(1)
    expect(second.calls).toHaveLength(0)
  })

  it('a file that has been edited is changed again', () => {
    const first = counting()
    uninstall = installTraceHook(withCache({ instrument: first.instrument }))
    load(join(dir, 'traced', 'a.cjs')); uninstall()
    writeFileSync(join(dir, 'traced', 'a.cjs'), 'module.exports = { add(a, b) { return a + b + 1000 } }')
    const second = counting()
    uninstall = installTraceHook(withCache({ instrument: second.instrument }))
    expect(load(join(dir, 'traced', 'a.cjs')).add(1, 2)).toBe(1003)
    expect(second.calls).toHaveLength(1)
  })

  it('a different signature (the transform changed) starts again', () => {
    const first = counting()
    uninstall = installTraceHook(withCache({ instrument: first.instrument, signature: 'v1' }))
    load(join(dir, 'traced', 'a.cjs')); uninstall()
    const second = counting()
    uninstall = installTraceHook(withCache({ instrument: second.instrument, signature: 'v2' }))
    load(join(dir, 'traced', 'a.cjs'))
    expect(second.calls).toHaveLength(1)
  })

  it('a damaged cache entry is ignored and the file is changed again', () => {
    const first = counting()
    uninstall = installTraceHook(withCache({ instrument: first.instrument }))
    load(join(dir, 'traced', 'a.cjs')); uninstall()
    for (const name of require('node:fs').readdirSync(cache)) writeFileSync(join(cache, name), 'this is not javascript (((')
    const second = counting()
    uninstall = installTraceHook(withCache({ instrument: second.instrument }))
    expect(load(join(dir, 'traced', 'a.cjs')).add(1, 2)).toBe(3)
    expect(second.calls).toHaveLength(1)
  })

  it('a cache folder that cannot be written does not stop the file loading', () => {
    writeFileSync(join(cache, 'a-file'), 'x')   // a file where the cache folder would have to go
    uninstall = installTraceHook(withCache({ cacheDir: join(cache, 'a-file', 'sub') }))
    expect(load(join(dir, 'traced', 'a.cjs')).add(1, 2)).toBe(3)
  })

  it('cacheDir: false turns the cache off', () => {
    const first = counting()
    uninstall = installTraceHook(withCache({ instrument: first.instrument, cacheDir: false }))
    load(join(dir, 'traced', 'a.cjs')); uninstall()
    const second = counting()
    uninstall = installTraceHook(withCache({ instrument: second.instrument, cacheDir: false }))
    load(join(dir, 'traced', 'a.cjs'))
    expect(second.calls).toHaveLength(1)
  })

  it('the transform is not even loaded when everything comes from the cache', () => {
    uninstall = installTraceHook(withCache())
    load(join(dir, 'traced', 'a.cjs')); uninstall()
    const loadTransform = vi.fn(() => instrument)
    uninstall = installTraceHook(withCache({ instrument: undefined, loadInstrument: loadTransform }))
    load(join(dir, 'traced', 'a.cjs'))
    expect(loadTransform).not.toHaveBeenCalled()
  })
})

describe('installTraceHook: where the cache lives', () => {
  it('by default it is inside the checkout (node_modules/.cache), not in the shared temp folder, and is not used if it is a symlink', () => {
    const fs = require('node:fs')
    uninstall = installTraceHook({ root: dir, instrument, shouldTrace: (rel) => rel.startsWith('traced/'), signature: 'v1' })
    delete require.cache[join(dir, 'traced', 'a.cjs')]
    require(join(dir, 'traced', 'a.cjs'))
    const folder = join(dir, 'node_modules', '.cache', 'nexusmd-trace')
    expect(fs.readdirSync(folder).some(n => n.endsWith('.js'))).toBe(true)
    if (process.platform !== 'win32') expect(fs.statSync(folder).mode & 0o077).toBe(0)   // private to the user
    uninstall()

    // a cache folder that has been swapped for a link is not trusted: files are changed in memory and nothing is read or written there
    const elsewhere = mkdtempSync(join(tmpdir(), 'nxt-elsewhere-'))
    try {
      fs.rmSync(folder, { recursive: true, force: true })
      try { fs.symlinkSync(elsewhere, folder, 'junction') } catch { return } // cannot make a link here: nothing more to check
      writeFileSync(join(dir, 'traced', 'b.cjs'), 'module.exports = { n: 2 }')
      const counted = []
      uninstall = installTraceHook({ root: dir, instrument: (c, o) => { counted.push(o.filename); return instrument(c, o) }, shouldTrace: (rel) => rel.startsWith('traced/'), signature: 'v1' })
      delete require.cache[join(dir, 'traced', 'b.cjs')]
      expect(require(join(dir, 'traced', 'b.cjs')).n).toBe(2)
      expect(fs.readdirSync(elsewhere)).toEqual([])
    } finally { rmSync(elsewhere, { recursive: true, force: true }) }
  })
})
