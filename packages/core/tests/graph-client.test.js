import { describe, it, expect, vi, beforeEach } from 'vitest'
import { graphFetch, graphJSON, graphList } from '../src/modules/graph/client.js'

beforeEach(() => {
  global.fetch = vi.fn()
})

describe('graphFetch', () => {
  it('prefixes the Graph base URL for a relative path', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    const getToken = vi.fn(async () => 'tok')
    await graphFetch(getToken, '/me')
    const [url] = global.fetch.mock.calls[0]
    expect(url).toBe('https://graph.microsoft.com/v1.0/me')
  })

  it('does not re-prefix an already-absolute URL (pagination links)', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    const getToken = vi.fn(async () => 'tok')
    await graphFetch(getToken, 'https://graph.microsoft.com/v1.0/me/messages?$skip=10')
    const [url] = global.fetch.mock.calls[0]
    expect(url).toBe('https://graph.microsoft.com/v1.0/me/messages?$skip=10')
  })

  it('sends the Bearer token from getToken', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    const getToken = vi.fn(async () => 'my-token')
    await graphFetch(getToken, '/me')
    const [, opts] = global.fetch.mock.calls[0]
    expect(opts.headers.Authorization).toBe('Bearer my-token')
  })

  it('retries exactly once with a forced token refresh on 401, then succeeds', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: false, status: 401 })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: 1 }) })
    const getToken = vi.fn(async ({ force } = {}) => (force ? 'fresh-token' : 'stale-token'))
    const res = await graphFetch(getToken, '/me')
    expect(await res.json()).toEqual({ ok: 1 })
    expect(getToken).toHaveBeenCalledTimes(2)
    expect(getToken).toHaveBeenNthCalledWith(2, { force: true })
    expect(global.fetch).toHaveBeenCalledTimes(2)
    expect(global.fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer fresh-token')
  })

  it('throws if the retried request is still a 401', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 401 })
    const getToken = vi.fn(async () => 'tok')
    await expect(graphFetch(getToken, '/me')).rejects.toThrow('Graph request failed (401): /me')
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('throws on a non-401 non-ok response without retrying', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 403 })
    const getToken = vi.fn(async () => 'tok')
    await expect(graphFetch(getToken, '/me/drive')).rejects.toThrow('Graph request failed (403): /me/drive')
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })
})

describe('graphJSON', () => {
  it('calls /me — the minimal-permission (User.Read-only) example — and returns parsed JSON', async () => {
    global.fetch.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ id: 'abc', displayName: 'Ada Lovelace', userPrincipalName: 'ada@example.com' }),
    })
    const getToken = vi.fn(async () => 'tok')
    const me = await graphJSON(getToken, '/me')
    expect(global.fetch.mock.calls[0][0]).toBe('https://graph.microsoft.com/v1.0/me')
    expect(me).toEqual({ id: 'abc', displayName: 'Ada Lovelace', userPrincipalName: 'ada@example.com' })
  })
})

describe('graphList', () => {
  it('concatenates value arrays across @odata.nextLink pages', async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ value: [{ id: 1 }, { id: 2 }], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/messages?$skip=2' }),
      })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ value: [{ id: 3 }] }),
      })
    const getToken = vi.fn(async () => 'tok')
    const all = await graphList(getToken, '/me/messages')
    expect(all).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }])
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('returns an empty array when value is absent', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    const getToken = vi.fn(async () => 'tok')
    const all = await graphList(getToken, '/me/messages')
    expect(all).toEqual([])
  })
})
