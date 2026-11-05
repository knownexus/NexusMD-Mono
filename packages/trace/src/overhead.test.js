// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest'
import { createRequire } from 'node:module'
import { instrument } from './instrument.mjs'

const require = createRequire(import.meta.url)
const nxt = require('./runtime.js')
afterEach(() => { nxt.stop(); nxt.drain() })

// The bound is loose (the bench in packages/trace/bench measures about 1.1x) because a test must not be flaky; what it guards is a
// change that makes a traced function do real work when nothing is recording.
const make = (src, traced) => {
  const code = traced ? instrument(src, { filename: '/repo/x.js', root: '/repo', sourceType: 'script' }).code : src
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', `${code}\nmodule.exports = f`)(mod, mod.exports, require)
  return mod.exports
}
const run = (fn, n) => { const t0 = process.hrtime.bigint(); let s = 0; for (let i = 0; i < n; i++) s += fn(i, 2); return Number(process.hrtime.bigint() - t0) / 1e6 }
const best = (fn, n, rounds = 5) => Math.min(...Array.from({ length: rounds }, () => run(fn, n)))
const SRC = 'function f(a, b) { const o = { x: a, y: b }; return o.x * 2 + o.y }'

describe('the cost of a traced function', () => {
  it('with nothing recording, a million calls take under twice as long as the same function without the reports', () => {
    const plain = make(SRC, false)
    const traced = make(SRC, true)
    nxt.stop()
    run(plain, 300000); run(traced, 300000) // warm up
    const ratio = best(traced, 1_000_000) / best(plain, 1_000_000)
    expect(ratio).toBeLessThan(2)
  })

  it('this check can fail: with a recording running the same loop is many times slower', () => {
    const plain = make(SRC, false)
    const traced = make(SRC, true)
    nxt.start({ proc: 'main', maxEvents: 5_000_000 })
    const ratio = best(traced, 20000, 3) / best(plain, 20000, 3)
    expect(ratio).toBeGreaterThan(5)
  })
})
