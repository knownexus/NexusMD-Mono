import { describe, it, expect, vi } from 'vitest'
import { installFetchLogging } from './log-fetch.js'

const makeLog = () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() })
const response = (status) => ({ status, ok: status >= 200 && status < 300 })
const setup = (impl, opts = {}) => {
  const target = { fetch: vi.fn(impl) }
  const log = opts.log ?? makeLog()
  let t = 0
  const uninstall = installFetchLogging(target, { log, now: () => t, base: 'https://nexus.app/', ...opts.extra })
  return { target, log, uninstall, advance: (ms) => { t += ms } }
}

describe('installFetchLogging', () => {
  it('gives the page exactly the response it would have had, and says nothing about a success', async () => {
    const res = response(200)
    const { target, log } = setup(async () => res)
    expect(await target.fetch('https://api.example.com/items')).toBe(res)
    for (const level of ['error', 'warn', 'info', 'debug']) expect(log[level]).not.toHaveBeenCalled()
  })

  it('logs a request that could not be made (offline, DNS, TLS, CORS) as a warning, and rethrows the same error', async () => {
    const boom = new TypeError('Failed to fetch')
    const { target, log } = setup(async () => { throw boom })
    await expect(target.fetch('https://api.example.com/api/account/login', { method: 'POST' })).rejects.toBe(boom)
    expect(log.warn).toHaveBeenCalledTimes(1)
    const [msg, err, data] = log.warn.mock.calls[0]
    expect(msg).toBe('request failed: POST api.example.com/api/account/login')
    expect(err).toBe(boom)
    expect(data).toMatchObject({ method: 'POST', url: 'https://api.example.com/api/account/login' })
  })

  it('logs a server error (5xx) as a warning and a client error (4xx) as info, and returns the response untouched', async () => {
    const r500 = response(503); const r404 = response(404)
    const { target, log } = setup(async (u) => (String(u).endsWith('/a') ? r500 : r404))
    expect(await target.fetch('https://x.test/a')).toBe(r500)
    expect(await target.fetch('https://x.test/b')).toBe(r404)
    expect(log.warn.mock.calls[0][0]).toBe('request failed: GET x.test/a (503)')
    expect(log.warn.mock.calls[0][1]).toMatchObject({ status: 503, method: 'GET' })
    expect(log.info.mock.calls[0][0]).toBe('request was refused: GET x.test/b (404)')
  })

  it('does not log a redirect or an ordinary success', async () => {
    const { target, log } = setup(async () => response(304))
    await target.fetch('https://x.test/c')
    expect(log.info).not.toHaveBeenCalled()
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('never puts a query string, a fragment or a password in the log (tokens travel there)', async () => {
    const { target, log } = setup(async () => { throw new TypeError('Failed to fetch') })
    await target.fetch('https://user:hunter2@api.example.com/cb?code=SECRET&state=abc#frag').catch(() => {})
    const all = JSON.stringify(log.warn.mock.calls)
    expect(all).not.toMatch(/SECRET|hunter2|state=|frag/)
    expect(log.warn.mock.calls[0][2].url).toBe('https://api.example.com/cb')
  })

  it('resolves a relative address against the page', async () => {
    const { target, log } = setup(async () => { throw new TypeError('Failed to fetch') })
    await target.fetch('/api/ping?x=1').catch(() => {})
    expect(log.warn.mock.calls[0][2].url).toBe('https://nexus.app/api/ping')
  })

  it('reads the address and method from a Request object, and from a URL object', async () => {
    const { target, log } = setup(async () => response(500))
    await target.fetch({ url: 'https://x.test/r', method: 'delete' })
    await target.fetch(new URL('https://x.test/u?q=1'))
    expect(log.warn.mock.calls[0][0]).toBe('request failed: DELETE x.test/r (500)')
    expect(log.warn.mock.calls[1][0]).toBe('request failed: GET x.test/u (500)')
  })

  it('treats a request the page cancelled as ordinary: debug, not a warning', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' })
    const { target, log } = setup(async () => { throw abort })
    await expect(target.fetch('https://x.test/slow')).rejects.toBe(abort)
    expect(log.warn).not.toHaveBeenCalled()
    expect(log.debug).toHaveBeenCalledTimes(1)
  })

  it('says how long a failed request took', async () => {
    const t = { now: 0 }
    const target = { fetch: async () => { t.now = 250; throw new TypeError('Failed to fetch') } }
    const log = makeLog()
    installFetchLogging(target, { log, now: () => t.now, base: 'https://nexus.app/' })
    await target.fetch('https://x.test/d').catch(() => {})
    expect(log.warn.mock.calls[0][2].ms).toBe(250)
  })

  it('files a repeated identical failure once, then again with a count after a minute (a poll must not flood the log)', async () => {
    const { target, log, advance } = setup(async () => { throw new TypeError('Failed to fetch') })
    for (let i = 0; i < 5; i++) await target.fetch('https://x.test/poll').catch(() => {})
    expect(log.warn).toHaveBeenCalledTimes(1)
    advance(61000)
    await target.fetch('https://x.test/poll').catch(() => {})
    expect(log.warn).toHaveBeenCalledTimes(2)
    expect(log.warn.mock.calls[1][2]).toMatchObject({ suppressed: 4 })
  })

  it('counts a different address, status or method as a different failure', async () => {
    const { target, log } = setup(async () => { throw new TypeError('Failed to fetch') })
    await target.fetch('https://x.test/a').catch(() => {})
    await target.fetch('https://x.test/b').catch(() => {})
    await target.fetch('https://x.test/a', { method: 'POST' }).catch(() => {})
    expect(log.warn).toHaveBeenCalledTimes(3)
  })

  it('cannot break the page: a logger that throws changes nothing', async () => {
    const log = makeLog(); log.warn.mockImplementation(() => { throw new Error('log is down') }); log.info.mockImplementation(() => { throw new Error('log is down') })
    const boom = new TypeError('Failed to fetch'); const res = response(404)
    const a = setup(async () => { throw boom }, { log })
    await expect(a.target.fetch('https://x.test/e')).rejects.toBe(boom)
    const b = setup(async () => res, { log })
    expect(await b.target.fetch('https://x.test/f')).toBe(res)
  })

  it('keeps the arguments and the page as `this`', async () => {
    const calls = []
    const target = { fetch(...args) { calls.push([this, args]); return Promise.resolve(response(200)) } }
    installFetchLogging(target, { log: makeLog(), base: 'https://nexus.app/' })
    const init = { method: 'PUT' }
    await target.fetch('https://x.test/g', init)
    expect(calls[0][0]).toBe(target)
    expect(calls[0][1][1]).toBe(init)
  })

  it('is installed once, and removing it puts the original back', async () => {
    const original = vi.fn(async () => response(200))
    const target = { fetch: original }
    const off1 = installFetchLogging(target, { log: makeLog(), base: 'https://nexus.app/' })
    const wrapped = target.fetch
    const off2 = installFetchLogging(target, { log: makeLog(), base: 'https://nexus.app/' })
    expect(target.fetch).toBe(wrapped)
    off2()
    expect(target.fetch).toBe(wrapped)
    off1()
    expect(target.fetch).toBe(original)
  })

  it('with no target it wraps the page fetch itself (how the entry points call it)', async () => {
    const real = globalThis.fetch
    const stub = vi.fn(async () => response(503))
    globalThis.fetch = stub
    const log = makeLog()
    const off = installFetchLogging(undefined, { log })
    try {
      expect(globalThis.fetch).not.toBe(stub)
      await globalThis.fetch('https://x.test/default')
      expect(log.warn).toHaveBeenCalledTimes(1)
    } finally {
      off()
      globalThis.fetch = real
    }
    expect(stub).toHaveBeenCalledTimes(1)
  })

  it('does nothing where there is no fetch', () => {
    expect(installFetchLogging({}, { log: makeLog() })).toBeTypeOf('function')
    expect(installFetchLogging(undefined, { log: makeLog() })).toBeTypeOf('function')
  })
})
