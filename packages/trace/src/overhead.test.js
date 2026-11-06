// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest'
import { createRequire } from 'node:module'
import { instrument } from './instrument.mjs'

const require = createRequire(import.meta.url)
const real = require('./runtime.js')
afterEach(() => { globalThis.__nxt = real; real.stop(); real.drain() })

// A test that measured time would be flaky when the whole suite runs at once (it was: 2.06x against a bound of 2x), so this checks
// the thing that makes a traced function cheap instead: when nothing is recording, it never asks the recorder to do anything.
// What the cost comes to in time is measured by packages/trace/bench/overhead.bench.mjs and apps/desktop/scripts/trace-cost.mjs.
const traced = (src, spy) => {
  globalThis.__nxt = spy // the transformed file takes the runtime it finds when it loads
  const { code } = instrument(src, { filename: '/repo/x.js', root: '/repo', sourceType: 'script' })
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', `${code}\nmodule.exports = f`)(mod, mod.exports, require)
  globalThis.__nxt = real
  return mod.exports
}
const spy = (on) => {
  const calls = { enter: 0, ret: 0, err: 0, aw: 0 }
  return { calls, on, enter() { calls.enter++; return on ? { id: 'x-1' } : null }, ret(f, v) { calls.ret++; return v }, err() { calls.err++ }, aw(f, v) { calls.aw++; return v }, resume: (f, v) => v }
}
const SRC = 'function f(a, b) { const o = { x: a, y: b }; return o.x * 2 + o.y }'

describe('what a traced function does when nothing is recording', () => {
  it('never calls enter (so it never builds the argument list, an id or an event), and still returns what it returns', () => {
    const s = spy(false)
    const f = traced(SRC, s)
    let sum = 0
    for (let i = 0; i < 1000; i++) sum += f(i, 2)
    expect(sum).toBe(1000 * 999 + 2000)
    expect(s.calls.enter).toBe(0)
    expect(s.calls.err).toBe(0)
  })

  it('this check can fail: with a recording running it does call enter, once per call', () => {
    const s = spy(true)
    const f = traced(SRC, s)
    for (let i = 0; i < 1000; i++) f(i, 2)
    expect(s.calls.enter).toBe(1000)
  })
})
