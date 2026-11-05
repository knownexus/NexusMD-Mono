// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'node:module'
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping'
import { instrument } from './instrument.mjs'

const require = createRequire(import.meta.url)
const nxt = require('./runtime.js')

beforeEach(() => { nxt.start({ proc: 'main' }); nxt.stop(); nxt.drain() })
afterEach(() => { nxt.stop(); nxt.drain() })

const SKIP_OPTS = { filename: '/repo/src/x.js', root: '/repo' }

// Runs CommonJS-style source and returns its exports.
function evaluate(code) {
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', code)(mod, mod.exports, require)
  return mod.exports
}
const traced = (src, opts = {}) => {
  const out = instrument(src, { ...SKIP_OPTS, sourceType: 'script', ...opts })
  if (!out) throw new Error('nothing was traced')
  return out
}
const outcome = async (fn) => { try { return { value: await fn() } } catch (e) { return { threw: String(e && e.message) } } }

const FORMS = {
  'plain function': { src: 'function f(a, b) { if (a > 5) throw new Error("too big " + this.tag); return a + b + this.tag.length }  module.exports = { f, tag: "T" }', call: (m) => m.f.call({ tag: 'ab' }, 1, 2), bad: (m) => m.f.call({ tag: 'ab' }, 9, 2) },
  'arrow with expression body': { src: 'const f = (a, b) => a * b; module.exports = { f }', call: (m) => m.f(3, 4) },
  'method': { src: 'const o = { n: 5, f(x) { return this.n + x } }; module.exports = { f: o.f, o }', call: (m) => m.o.f(2) },
  'class method': { src: 'class A { constructor() { this.n = 3 } f(x) { return this.n * x } } module.exports = { A }', call: (m) => new m.A().f(4) },
  'async function': { src: 'async function f(a) { const v = await Promise.resolve(a + 1); if (v > 5) throw new Error("late"); return v * 2 } module.exports = { f }', call: (m) => m.f(1), bad: (m) => m.f(9) },
  'generator': { src: 'function* g(n) { for (let i = 0; i < n; i++) { const got = yield i; if (got) return got } return "end" } module.exports = { g }', call: (m) => { const it = m.g(3); return [it.next().value, it.next().value, it.next().value, it.next().value] } },
  'async generator': { src: 'async function* g(n) { for (let i = 0; i < n; i++) { await null; yield i } } module.exports = { g }', call: async (m) => { const out = []; for await (const v of m.g(3)) out.push(v); return out } },
}

describe('behaviour is unchanged', () => {
  for (const [name, form] of Object.entries(FORMS)) {
    for (const recording of [false, true]) {
      it(`${name}: same result and same error, recording ${recording ? 'on' : 'off'}`, async () => {
        const plain = evaluate(form.src)
        const t = evaluate(traced(form.src).code)
        if (recording) nxt.start({ proc: 'main' })
        expect(await outcome(() => form.call(t))).toEqual(await outcome(() => form.call(plain)))
        if (form.bad) expect(await outcome(() => form.bad(t))).toEqual(await outcome(() => form.bad(plain)))
        if (recording) expect(nxt.drain().some(e => e.k === 'enter')).toBe(true)
      })
    }
  }

  it('this and arguments are preserved in functions; name and length are unchanged', () => {
    const src = 'function f(a, b, c) { return [this.k, arguments.length, arguments[1]] } module.exports = { f }'
    const t = evaluate(traced(src).code)
    nxt.start({ proc: 'main' })
    expect(t.f.call({ k: 'K' }, 1, 2, 3, 4)).toEqual(['K', 4, 2])
    expect(t.f.name).toBe('f')
    expect(t.f.length).toBe(3)
  })

  it('a function that already has a try/finally and early returns keeps its meaning', () => {
    const src = 'function f(x) { try { if (x) return "early"; return "late" } finally { module.exports.log.push("fin") } } module.exports = { f, log: [] }'
    const t = evaluate(traced(src).code)
    nxt.start({ proc: 'main' })
    expect(t.f(1)).toBe('early'); expect(t.f(0)).toBe('late'); expect(t.log).toEqual(['fin', 'fin'])
  })
})

describe('what is recorded', () => {
  it('records arguments, the return value and the thrown error', () => {
    const t = evaluate(traced('function add(a, b) { return a + b } function bad() { throw new RangeError("no") } module.exports = { add, bad }').code)
    nxt.start({ proc: 'main' })
    t.add(2, 3); try { t.bad() } catch { /* expected */ }
    const evs = nxt.drain()
    expect(evs.find(e => e.k === 'enter' && e.fn.endsWith(':add')).a).toEqual([2, 3])
    expect(evs.find(e => e.k === 'ret').v).toBe(5)
    expect(evs.find(e => e.k === 'err').e).toMatchObject({ name: 'RangeError', message: 'no' })
  })

  it('names a function by file, line, column and name relative to the root', () => {
    const t = evaluate(traced('\n\nfunction named() { return 1 }\nmodule.exports = { named }', { filename: '/repo/src/deep/x.js' }).code)
    nxt.start({ proc: 'main' }); t.named()
    expect(nxt.drain().find(e => e.k === 'enter').fn).toBe('src/deep/x.js:3:0:named')
  })

  it("an async function's child call after an await nests under it", async () => {
    const src = 'async function parent() { await Promise.resolve(); return child() } function child() { return 1 } module.exports = { parent }'
    const t = evaluate(traced(src).code)
    nxt.start({ proc: 'main' })
    await t.parent()
    const enters = nxt.drain().filter(e => e.k === 'enter')
    const parent = enters.find(e => e.fn.endsWith(':parent')); const child = enters.find(e => e.fn.endsWith(':child'))
    expect(child.p).toBe(parent.id)
  })

  it('two interleaved async calls keep their children apart', async () => {
    const src = 'const sleep = (ms) => new Promise(r => setTimeout(r, ms)); async function job(name, ms) { await sleep(ms); return leaf(name) } function leaf(n) { return n } module.exports = { job }'
    const t = evaluate(traced(src).code)
    nxt.start({ proc: 'main' })
    await Promise.all([t.job('a', 15), t.job('b', 2)])
    const evs = nxt.drain().filter(e => e.k === 'enter')
    const jobs = evs.filter(e => e.fn.endsWith(':job'))
    for (const leaf of evs.filter(e => e.fn.endsWith(':leaf'))) {
      const parent = jobs.find(j => j.id === leaf.p)
      expect(parent).toBeTruthy()
      expect(parent.a[0]).toBe(leaf.a[0])
    }
  })
})

describe('what is left alone', () => {
  const names = (src) => { const out = instrument(src, SKIP_OPTS); return out ? [...out.code.matchAll(/__nxt\.enter\("[^"]*:(\w+)"/g)].map(m => m[1]) : [] }

  it('a function with JSX, a useThing hook, getters, setters, a constructor and a .map callback', () => {
    const src = [
      'function Widget() { return <div/> }',
      'function useThing() { return 1 }',
      'class C { constructor() { this.a = 1 } get g() { return 1 } set s(v) { this.v = v } real() { return [1].map(x => x + 1) } }',
      'function plain() { return 1 }',
    ].join('\n')
    expect(names(src).sort()).toEqual(['plain', 'real'])
  })

  it('a handler inside a component is still traced', () => {
    expect(names('function Page() { const onClick = () => merge(); return <button onClick={onClick}/> } function merge() { return 1 }')).toEqual(expect.arrayContaining(['merge', 'onClick']))
  })

  it('a file with nothing to trace returns null, and so does a syntax error (it never throws)', () => {
    expect(instrument('const x = 1; export default x', SKIP_OPTS)).toBeNull()
    expect(instrument('function (', SKIP_OPTS)).toBeNull()
  })

  it('files under node_modules and test files are left alone', () => {
    expect(instrument('function f() { return 1 }', { filename: '/repo/node_modules/x/index.js', root: '/repo' })).toBeNull()
    expect(instrument('function f() { return 1 }', { filename: '/repo/src/x.test.js', root: '/repo' })).toBeNull()
  })

  it('an exclude list names functions and files to leave alone', () => {
    const src = 'function hot() { return 1 } function calm() { return 2 }'
    expect(names(src)).toEqual(['hot', 'calm'])
    const out = instrument(src, { ...SKIP_OPTS, exclude: { functions: ['hot'] } })
    expect([...out.code.matchAll(/__nxt\.enter\("[^"]*:(\w+)"/g)].map(m => m[1])).toEqual(['calm'])
    expect(instrument(src, { ...SKIP_OPTS, exclude: { files: ['src/x.js'] } })).toBeNull()
  })

  it('transforming twice does not trace a function twice', () => {
    const once = traced('function f() { return 1 }')
    const again = instrument(once.code, { ...SKIP_OPTS, sourceType: 'script' })
    const count = (s) => (s.match(/__nxt\.enter\(/g) || []).length
    expect(count(again ? again.code : once.code)).toBe(1)
  })
})

describe('source map', () => {
  it('maps a traced function back to its original line', () => {
    const src = ['// header', '', 'function target(a) {', '  return a + 1', '}', 'module.exports = { target }'].join('\n')
    const out = traced(src)
    const lines = out.code.split('\n')
    const line = lines.findIndex(l => l.includes('a + 1')) + 1
    expect(line).toBeGreaterThan(0)
    const col = lines[line - 1].indexOf('a + 1')
    const pos = originalPositionFor(new TraceMap(out.map), { line, column: col })
    expect(pos.line).toBe(4)
  })
})
