// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRequire } from 'node:module'
import { installFetchCapture } from './fetch-capture.js'

const nxt = createRequire(import.meta.url)('../../../trace/src/runtime.js')
let uninstall
beforeEach(() => { nxt.start({ proc: 'renderer', win: 1 }); nxt.drain() })
afterEach(() => { uninstall?.(); uninstall = undefined; nxt.stop(); nxt.drain() })

const respond = (body, init = {}) => new Response(body, { status: 200, headers: { 'content-type': 'application/json' }, ...init })
const fakeWindow = (impl) => ({ fetch: vi.fn(impl) })
// The responses are read after the page has its own copy, and a large one takes longer: wait for `count` requests to appear.
const nets = async (count = 1) => {
  const found = []
  for (let i = 0; i < 400 && found.length < count; i++) { await new Promise(r => setTimeout(r, 5)); found.push(...nxt.drain().filter(e => e.k === 'net')) }
  return found
}

describe('installFetchCapture', () => {
  it('records a request with method, url, headers and body, and the response with status, headers, body and duration', async () => {
    const w = fakeWindow(async () => respond('{"merged":true}', { status: 200, headers: { 'content-type': 'application/json', 'x-ratelimit': '9' } }))
    uninstall = installFetchCapture(w)
    await w.fetch('https://api.example.com/pulls/4411/merge', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Trace': '1' }, body: '{"merge_method":"squash"}' })
    const [ev] = await nets()
    expect(ev.d).toMatchObject({
      method: 'PUT', url: 'https://api.example.com/pulls/4411/merge', status: 200,
      body: '{"merge_method":"squash"}', responseBody: '{"merged":true}',
    })
    expect(ev.d.headers).toMatchObject({ 'content-type': 'application/json', 'x-trace': '1' })
    expect(ev.d.responseHeaders['x-ratelimit']).toBe('9')
    expect(typeof ev.d.ms).toBe('number')
  })

  it('the caller still gets a response it can read', async () => {
    const w = fakeWindow(async () => respond('{"a":1}'))
    uninstall = installFetchCapture(w)
    const res = await w.fetch('https://x.example.com/a')
    expect(await res.json()).toEqual({ a: 1 })
  })

  it('the request is a child of the call that made it', async () => {
    const w = fakeWindow(async () => respond('{}'))
    uninstall = installFetchCapture(w)
    const f = nxt.enter('a.js:1:0:merge', null, [])
    await w.fetch('https://x.example.com/a')
    nxt.ret(f, 0)
    const [ev] = await nets()
    expect(ev.p).toBe(f.id)
  })

  it('a failing request records the error and rethrows it', async () => {
    const w = fakeWindow(async () => { throw new TypeError('Failed to fetch') })
    uninstall = installFetchCapture(w)
    await expect(w.fetch('https://x.example.com/a')).rejects.toThrow('Failed to fetch')
    const [ev] = await nets()
    expect(ev.d).toMatchObject({ method: 'GET', url: 'https://x.example.com/a', error: 'Failed to fetch' })
  })

  it('a large body and a binary body are cut to a marker with their size, and a huge one is not even read', async () => {
    const big = 'x'.repeat(5 * 1024 * 1024)
    const w = fakeWindow(async (url) => (url.endsWith('/img')
      ? respond(new Uint8Array(1000), { headers: { 'content-type': 'image/png' } })
      : url.endsWith('/huge') ? respond('tiny', { headers: { 'content-type': 'text/plain', 'content-length': String(80 * 1024 * 1024) } })
        : respond(big, { headers: { 'content-type': 'text/plain' } })))
    uninstall = installFetchCapture(w)
    await w.fetch('https://x.example.com/big', { method: 'POST', body: big })
    await w.fetch('https://x.example.com/img')
    await w.fetch('https://x.example.com/huge')
    const found = await nets(3)
    const [bigEv, imgEv, hugeEv] = ['/big', '/img', '/huge'].map(u => found.find(e => e.d.url.endsWith(u)))
    expect(bigEv.d.body).toEqual({ $cut: 'body', bytes: big.length })
    expect(bigEv.d.responseBody).toEqual({ $cut: 'body', bytes: big.length })
    expect(imgEv.d.responseBody).toEqual({ $cut: 'body', bytes: 1000 })
    expect(hugeEv.d.responseBody).toEqual({ $cut: 'body', bytes: 80 * 1024 * 1024 })
  })

  it('a Request object and a URL object are understood', async () => {
    const w = fakeWindow(async () => respond('{}'))
    uninstall = installFetchCapture(w)
    await w.fetch(new Request('https://x.example.com/r', { method: 'DELETE' }))
    await w.fetch(new URL('https://x.example.com/u'))
    const [a, b] = await nets(2)
    expect(a.d).toMatchObject({ method: 'DELETE', url: 'https://x.example.com/r' })
    expect(b.d).toMatchObject({ method: 'GET', url: 'https://x.example.com/u' })
  })

  it('not recording: the original fetch is called as it was, and nothing is recorded', async () => {
    nxt.stop(); nxt.drain()
    const original = vi.fn(async () => respond('{}'))
    const w = { fetch: original }
    uninstall = installFetchCapture(w)
    const res = await w.fetch('https://x.example.com/a', { method: 'POST' })
    expect(original).toHaveBeenCalledWith('https://x.example.com/a', { method: 'POST' })
    expect(await res.text()).toBe('{}')
    expect(nxt.drain()).toEqual([])
  })

  it('uninstall puts the original fetch back', () => {
    const w = fakeWindow(async () => respond('{}'))
    const original = w.fetch
    const off = installFetchCapture(w)
    expect(w.fetch).not.toBe(original)
    off()
    expect(w.fetch).toBe(original)
  })

  it('a response that cannot be read still reaches the caller, and the request is recorded without a body', async () => {
    const bad = respond('x'); bad.clone = () => { throw new Error('clone failed') }
    const w = fakeWindow(async () => bad)
    uninstall = installFetchCapture(w)
    expect(await w.fetch('https://x.example.com/a')).toBe(bad)
    const [ev] = await nets()
    expect(ev.d.status).toBe(200)
    expect(ev.d.responseBody).toBeUndefined()
  })
})
