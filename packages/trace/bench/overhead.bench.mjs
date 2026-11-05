// How much a traced function costs when nothing is recording: the same functions, plain and with the call reports added, called a
// million times. Run: node packages/trace/bench/overhead.bench.mjs
import { createRequire } from 'node:module'
import { instrument } from '../src/instrument.mjs'

const require = createRequire(import.meta.url)
require('../src/runtime.js') // recording is off

const SOURCES = {
  'tiny (a + b)': 'function f(a, b) { return a + b }',
  'small (object work)': 'function f(a, b) { const o = { x: a, y: b }; return o.x * 2 + o.y }',
  'arrow (key builder)': 'const f = (a, b) => `${a}.${b}`',
  'method (this)': 'const o = { n: 3, f(a) { return this.n + a } }',
}
const evaluate = (code, name) => {
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', `${code}\nmodule.exports = typeof f === 'function' ? f : o.f.bind(o)`)(mod, mod.exports, require)
  return mod.exports
}
const time = (fn, n) => { const t0 = process.hrtime.bigint(); let s = 0; for (let i = 0; i < n; i++) s += fn(i, 2) || 0; return { ms: Number(process.hrtime.bigint() - t0) / 1e6, s } }

const N = 3_000_000
console.log(`calls: ${N.toLocaleString()} each, recording off`)
for (const [name, src] of Object.entries(SOURCES)) {
  const plain = evaluate(src)
  const traced = evaluate(instrument(src, { filename: '/repo/x.js', root: '/repo', sourceType: 'script' }).code)
  for (let i = 0; i < 3; i++) { time(plain, 200000); time(traced, 200000) } // warm up
  const best = (fn) => Math.min(...Array.from({ length: 5 }, () => time(fn, N).ms))
  const p = best(plain), t = best(traced)
  console.log(`${name.padEnd(22)} plain ${p.toFixed(1)} ms   traced ${t.toFixed(1)} ms   x${(t / p).toFixed(2)}   (+${((t - p) / N * 1e6).toFixed(1)} ns per call)`)
}
