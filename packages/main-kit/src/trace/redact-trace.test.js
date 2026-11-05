// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { redactEvent, DEFAULT_DENY } = require('./redact-trace.cjs')
const { redactString } = require('../logging/redact.cjs')

const enter = (fn, a) => ({ k: 'enter', id: 'r1-1', p: null, fn, a, t: 1, proc: 'renderer' })
const net = (d) => ({ k: 'net', id: 'r1-2', p: 'r1-1', d, t: 1, proc: 'renderer' })

describe('redactEvent', () => {
  it('a bearer token in an argument string is hidden', () => {
    const out = redactEvent(enter('x.js:1:0:call', ['Bearer abcdefghijklmnop1234']))
    expect(JSON.stringify(out)).not.toContain('abcdefghijklmnop1234')
    expect(JSON.stringify(out)).toContain('[redacted]')
  })

  it('a token in a URL query (?access_token=abc) and a URL with user:pass@ are hidden', () => {
    const out = redactEvent(net({ method: 'GET', url: 'https://api.example.com/x?access_token=SECRETVALUE1&page=2' }))
    expect(out.d.url).not.toContain('SECRETVALUE1')
    expect(out.d.url).toContain('page=2')
    const cred = redactEvent(net({ url: 'https://bob:hunter2pw@host.example.com/repo' }))
    expect(cred.d.url).not.toContain('hunter2pw')
    const raw = redactEvent(enter('x.js:1:0:f', ['https://host/p?refresh_token=ZZZTOKEN99&a=1', 'id_token=QQQ12345&x=1']))
    expect(JSON.stringify(raw)).not.toMatch(/ZZZTOKEN99|QQQ12345/)
  })

  it('request headers authorization and cookie are hidden; other headers are kept', () => {
    const out = redactEvent(net({ headers: { Authorization: 'Basic dXNlcjpwYXNz', Cookie: 'sid=abc', 'x-api-key': 'k123', Accept: 'application/json' } }))
    expect(out.d.headers.Authorization).toBe('[redacted]')
    expect(out.d.headers.Cookie).toBe('[redacted]')
    expect(out.d.headers['x-api-key']).toBe('[redacted]')
    expect(out.d.headers.Accept).toBe('application/json')
  })

  it('a function named signInWithToken has its args and return replaced outright', () => {
    const e = redactEvent(enter('auth.js:3:0:signInWithToken', ['plain-looking-value-123']))
    expect(e.a).toEqual({ $redacted: 'function' })
    const r = redactEvent({ k: 'ret', id: 'r1-1', v: 'also-plain', t: 2, proc: 'renderer', fn: 'auth.js:3:0:signInWithToken' })
    expect(r.v).toEqual({ $redacted: 'function' })
  })

  it('a body from a /oauth/token url is replaced outright', () => {
    const out = redactEvent(net({ method: 'POST', url: 'https://login.example.com/oauth/token', body: 'grant_type=x&code=plain', responseBody: '{"ok":"plain"}' }))
    expect(out.d).toEqual({ $redacted: 'url' })
  })

  it('a value no rule recognises is kept as is', () => {
    const e = redactEvent(enter('pr.js:9:0:merge', [{ title: 'Fix refund rounding', branch: 'feature/x', note: 'ordinary-text-20c' }]))
    expect(e.a[0].title).toBe('Fix refund rounding')
    expect(e.a[0].note).toBe('ordinary-text-20c')
  })

  it('the input event is not mutated', () => {
    const e = enter('x.js:1:0:f', [{ password: 'pw123456', a: 'Bearer abcdefghijklmnop1234' }])
    const copy = JSON.parse(JSON.stringify(e))
    redactEvent(e)
    expect(e).toEqual(copy)
  })

  it('exposes the default rules', () => {
    expect(DEFAULT_DENY.urls.length).toBeGreaterThan(0)
    expect(DEFAULT_DENY.functions.every(r => r instanceof RegExp)).toBe(true)
  })
})

describe('redactString (shared with the logs): token names with an underscore', () => {
  it('hides access_token=, refresh_token=, id_token= and client_secret= values', () => {
    for (const k of ['access_token', 'refresh_token', 'id_token', 'client_secret']) {
      expect(redactString(`https://h/p?${k}=VALUE123&z=1`)).not.toContain('VALUE123')
    }
    expect(redactString('https://h/p?z=1&page=2')).toBe('https://h/p?z=1&page=2')
  })
})
