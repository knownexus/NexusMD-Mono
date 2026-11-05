// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const load = () => { delete require.cache[require.resolve('./runtime.js')]; return require('./runtime.js') }

let nxt
beforeEach(() => { delete globalThis.__nxt; nxt = load() })
afterEach(() => { nxt.stop?.(); nxt.drain?.(); delete globalThis.__nxt })

const kinds = (evs) => evs.map(e => e.k)

describe('frames', () => {
  it('enter/ret nest: a frame entered inside another has p = the outer id', () => {
    nxt.start({ proc: 'main' })
    const outer = nxt.enter('a.js:1:0:outer', null, [1])
    const inner = nxt.enter('a.js:5:0:inner', null, [2])
    nxt.ret(inner, 'x'); nxt.ret(outer, 'y')
    const evs = nxt.drain()
    const enters = evs.filter(e => e.k === 'enter')
    expect(enters[0].p).toBeNull()
    expect(enters[1].p).toBe(enters[0].id)
    expect(evs.find(e => e.k === 'ret' && e.id === inner.id).v).toBe('x')
    expect(enters[0].a).toEqual([1])
    expect(typeof evs[0].t).toBe('number')
  })

  it('err records name, message and stack; ret returns its value untouched', () => {
    nxt.start({ proc: 'main' })
    const f = nxt.enter('a.js:1:0:f', null, [])
    expect(nxt.err(f, new TypeError('boom'))).toBeUndefined()
    const e = nxt.drain().find(x => x.k === 'err')
    expect(e.e).toMatchObject({ name: 'TypeError', message: 'boom' })
    expect(typeof e.e.stack).toBe('string')
    const g = nxt.enter('a.js:1:0:g', null, [])
    const obj = { a: 1 }
    expect(nxt.ret(g, obj)).toBe(obj)
  })

  it('not recording: enter returns null, ret returns its value, no events', () => {
    expect(nxt.on).toBe(false)
    expect(nxt.enter('a.js:1:0:f', null, [])).toBeNull()
    expect(nxt.ret(null, 7)).toBe(7)
    expect(nxt.drain()).toEqual([])
  })

  it('ids carry the process kind and are unique', () => {
    nxt.start({ proc: 'renderer', win: 3 })
    const a = nxt.enter('a.js:1:0:a', null, []); const b = nxt.enter('a.js:1:0:b', null, [])
    expect(a.id).toMatch(/^r3-\d+$/)
    expect(a.id).not.toBe(b.id)
  })

  it('events after stop() are dropped', () => {
    nxt.start({ proc: 'main' })
    const f = nxt.enter('a.js:1:0:f', null, [])
    nxt.stop()
    nxt.ret(f, 1)
    expect(nxt.on).toBe(false)
    expect(kinds(nxt.drain())).toEqual(['enter'])
  })
})

describe('async', () => {
  it('after aw(f, p) and resume(f, v) a child enters under f, not under the caller', async () => {
    nxt.start({ proc: 'renderer', win: 1 })   // a window has no async context: a stack of frames
    const outer = nxt.enter('a.js:1:0:outer', null, [])
    const waiting = nxt.aw(outer, Promise.resolve(5))
    // the caller carries on while outer waits
    const other = nxt.enter('a.js:9:0:caller', null, []); nxt.ret(other, 0)
    const v = nxt.resume(outer, await waiting)
    const child = nxt.enter('a.js:3:0:child', null, [])
    nxt.ret(child, 0); nxt.ret(outer, v)
    const enters = nxt.drain().filter(e => e.k === 'enter')
    expect(enters.find(e => e.fn.endsWith(':caller')).p).toBeNull()
    expect(enters.find(e => e.fn.endsWith(':child')).p).toBe(outer.id)
    expect(v).toBe(5)
  })

  it('concurrent async calls nest under their own frames (Node async context)', async () => {
    nxt.start({ proc: 'main' })
    const call = async (name, ms) => {
      const f = nxt.enter(`a.js:1:0:${name}`, null, [])
      await nxt.run(f.id, async () => {
        await new Promise(r => setTimeout(r, ms))
        const c = nxt.enter(`a.js:2:0:${name}-child`, null, []); nxt.ret(c, 0)
      })
      nxt.ret(f, 0)
    }
    await Promise.all([call('a', 20), call('b', 5)])
    const enters = nxt.drain().filter(e => e.k === 'enter')
    const id = (n) => enters.find(e => e.fn.endsWith(`:${n}`)).id
    expect(enters.find(e => e.fn.endsWith(':a-child')).p).toBe(id('a'))
    expect(enters.find(e => e.fn.endsWith(':b-child')).p).toBe(id('b'))
  })

  it('run(parentId, fn) makes parentId the current frame and current() reports it', () => {
    nxt.start({ proc: 'main' })
    expect(nxt.current()).toBeNull()
    nxt.run('w1-7', () => {
      expect(nxt.current()).toBe('w1-7')
      const f = nxt.enter('a.js:1:0:f', null, [])
      expect(nxt.drain().find(e => e.k === 'enter').p).toBe('w1-7')
      nxt.ret(f, 0)
    })
    expect(nxt.current()).toBeNull()
  })
})

describe('emit', () => {
  it('emits a typed event under the current frame', () => {
    nxt.start({ proc: 'main' })
    const f = nxt.enter('a.js:1:0:f', null, [])
    const id = nxt.emit('log', { msg: 'hi' })
    nxt.ret(f, 0)
    const ev = nxt.drain().find(e => e.k === 'log')
    expect(ev).toMatchObject({ id, p: f.id, d: { msg: 'hi' } })
  })
})

describe('cut', () => {
  const nasty = () => {
    const circ = { name: 'c' }; circ.self = circ
    const getter = {}; Object.defineProperty(getter, 'boom', { enumerable: true, get() { throw new Error('nope') } })
    const proxy = new Proxy({}, { ownKeys() { throw new Error('trap') }, get() { throw new Error('trap') }, getPrototypeOf() { throw new Error('trap') } })
    return { circ, getter, proxy, big: 10n, sym: Symbol('s'), typed: new Uint8Array(1000), str: 'x'.repeat(1_000_000), list: Array.from({ length: 10_000 }, (_, i) => i), fn() {} }
  }
  it('turns circular, Proxy, throwing getter, BigInt, Symbol, typed array, a 1 MB string and a 10 000-item array into JSON-safe markers and never throws', () => {
    const out = nxt.cut(nasty())
    const text = JSON.stringify(out)
    expect(text.length).toBeLessThan(20_000)
    expect(out.circ.self).toEqual({ $cut: 'circular' })
    expect(JSON.stringify(out.getter)).toContain('$cut')
    expect(out.big).toEqual({ $cut: 'bigint', value: '10' })
    expect(out.typed).toEqual({ $cut: 'binary', bytes: 1000 })
    expect(out.str.length).toBeLessThan(2100)
    expect(out.str).toMatch(/\(\+\d+ chars\)$/)
    expect(out.list.length).toBeLessThanOrEqual(51)
    expect(JSON.stringify(out.proxy)).toContain('$cut')
  })
  it('keeps ordinary small values as they are', () => {
    expect(nxt.cut({ a: 1, b: ['x', null, true] })).toEqual({ a: 1, b: ['x', null, true] })
    expect(nxt.cut(undefined)).toEqual({ $cut: 'undefined' })
  })
  it('says a Promise is a promise (its result is not known yet) instead of showing an empty object', () => {
    expect(nxt.cut(Promise.resolve(1))).toEqual({ $cut: 'promise' })
  })
  it('goes no deeper than the depth limit', () => {
    const deep = { a: { b: { c: { d: { e: { f: 1 } } } } } }
    expect(JSON.stringify(nxt.cut(deep))).toContain('$cut')
    expect(nxt.cut(deep, { depth: 10 }).a.b.c.d.e.f).toBe(1)
  })
})

describe('cap', () => {
  it('past maxEvents the buffer gets one cap event, onCap fires once, and later enters return null', () => {
    const reasons = []
    nxt.onCap = (r) => reasons.push(r)
    nxt.start({ proc: 'main', maxEvents: 5 })
    for (let i = 0; i < 20; i++) { const f = nxt.enter(`a.js:${i}:0:f`, null, []); nxt.ret(f, 0) }
    const evs = nxt.drain()
    expect(evs.filter(e => e.k === 'cap')).toHaveLength(1)
    expect(reasons).toHaveLength(1)
    expect(nxt.enter('a.js:1:0:late', null, [])).toBeNull()
    expect(evs.length).toBeLessThanOrEqual(6)
  })
})

describe('install', () => {
  it('keeps an existing stub valid (the same object gains the methods)', () => {
    const stub = { on: false }
    globalThis.__nxt = stub
    const loaded = load()
    expect(globalThis.__nxt).toBe(stub)
    expect(typeof stub.enter).toBe('function')
    expect(loaded).toBe(stub)
  })
  it('never throws out of a method: a hostile value in args is cut, not thrown', () => {
    nxt.start({ proc: 'main' })
    const proxy = new Proxy({}, { ownKeys() { throw new Error('trap') } })
    expect(() => nxt.enter('a.js:1:0:f', null, [proxy])).not.toThrow()
  })
})
