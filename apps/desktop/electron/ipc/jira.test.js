// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { register, isAllowedJiraUrl } = require('./jira.cjs')

function makeFakeIpcMain() {
  const handlers = {}
  return {
    handle(channel, fn) { handlers[channel] = fn },
    invoke(channel, ...args) { return handlers[channel](null, ...args) },
  }
}

function fakeResponse(status, text, headers = {}) {
  return { ok: status < 300, status, headers: { get: n => headers[n] ?? null }, text: async () => text }
}

describe('isAllowedJiraUrl', () => {
  it('allows only https Jira Cloud REST URLs', () => {
    expect(isAllowedJiraUrl('https://acme.atlassian.net/rest/api/3/myself')).toBe(true)
    expect(isAllowedJiraUrl('http://acme.atlassian.net/rest/api/3/myself')).toBe(false)
    expect(isAllowedJiraUrl('https://evilatlassian.net/rest/api/3/myself')).toBe(false)
    expect(isAllowedJiraUrl('https://acme.atlassian.net/secure/Dashboard.jspa')).toBe(false)
    expect(isAllowedJiraUrl('https://example.com/rest/api/3/x')).toBe(false)
    expect(isAllowedJiraUrl('not a url')).toBe(false)
  })
})

describe('jira:request', () => {
  it('forwards an allowed request and returns status, retry-after and body', async () => {
    const fetchImpl = vi.fn(async () => fakeResponse(429, '{"x":1}', { 'retry-after': '3' }))
    const ipc = makeFakeIpcMain()
    register(ipc, { fetchImpl })
    const out = await ipc.invoke('jira:request', {
      url: 'https://acme.atlassian.net/rest/api/3/search/jql', method: 'POST',
      headers: { Authorization: 'Basic x', 'Content-Type': 'application/json' }, body: '{}',
    })
    expect(fetchImpl).toHaveBeenCalledWith('https://acme.atlassian.net/rest/api/3/search/jql', {
      method: 'POST',
      headers: { Authorization: 'Basic x', 'Content-Type': 'application/json', 'X-Atlassian-Token': 'no-check' },
      redirect: 'error', credentials: 'omit', body: '{}',
      signal: expect.any(AbortSignal),
    })
    const [, opts] = fetchImpl.mock.calls[0]
    expect(Object.keys(opts).sort()).toEqual(['body', 'credentials', 'headers', 'method', 'redirect', 'signal'])
    expect(opts.signal.aborted).toBe(false)
    expect(out).toEqual({ ok: false, status: 429, headers: { 'retry-after': '3' }, body: '{"x":1}' })
  })

  it('opts out of Jira XSRF checks and never sends session cookies, so POSTs work after signing in to Atlassian in a link window', async () => {
    const fetchImpl = vi.fn(async () => fakeResponse(200, '{}'))
    const ipc = makeFakeIpcMain()
    register(ipc, { fetchImpl })
    await ipc.invoke('jira:request', { url: 'https://acme.atlassian.net/rest/api/3/myself', headers: { Authorization: 'Basic x' } })
    const [, opts] = fetchImpl.mock.calls[0]
    expect(opts.headers['X-Atlassian-Token']).toBe('no-check')
    expect(opts.credentials).toBe('omit')
  })

  it('blocks non-Jira URLs without fetching', async () => {
    const fetchImpl = vi.fn()
    const ipc = makeFakeIpcMain()
    register(ipc, { fetchImpl })
    const out = await ipc.invoke('jira:request', { url: 'https://example.com/rest/x' })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(out).toMatchObject({ ok: false, status: 0, error: 'Blocked: not a Jira Cloud REST URL' })
  })

  it('sends attachments as multipart form data and drops any JSON content type', async () => {
    const fetchImpl = vi.fn(async () => fakeResponse(200, '[]'))
    const ipc = makeFakeIpcMain()
    register(ipc, { fetchImpl })
    await ipc.invoke('jira:request', {
      url: 'https://acme.atlassian.net/rest/api/3/issue/A-1/attachments', method: 'POST',
      headers: { 'X-Atlassian-Token': 'no-check', 'Content-Type': 'application/json' },
      attachment: { name: 'a.txt', type: 'text/plain', data: new TextEncoder().encode('hi').buffer },
    })
    const [, opts] = fetchImpl.mock.calls[0]
    expect(opts.headers).toEqual({ 'X-Atlassian-Token': 'no-check' })
    expect(opts.body).toBeInstanceOf(FormData)
    expect(opts.body.get('file').name).toBe('a.txt')
    expect(opts.redirect).toBe('error')
    expect(opts.signal).toBeInstanceOf(AbortSignal)
  })

  it('defaults to Electron net.fetch so the system proxy and OS certificates apply', async () => {
    const netFetch = vi.fn(async () => fakeResponse(200, '{}'))
    const electronPath = require.resolve('electron')
    const saved = require.cache[electronPath]
    require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: { net: { fetch: netFetch } } }
    try {
      const ipc = makeFakeIpcMain()
      register(ipc)
      const out = await ipc.invoke('jira:request', { url: 'https://acme.atlassian.net/rest/api/3/myself' })
      expect(netFetch).toHaveBeenCalledWith('https://acme.atlassian.net/rest/api/3/myself', expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) }))
      expect(out).toMatchObject({ ok: true, status: 200, body: '{}' })
    } finally {
      if (saved) require.cache[electronPath] = saved; else delete require.cache[electronPath]
    }
  })

  it('rejects redirects instead of following them', async () => {
    const ipc = makeFakeIpcMain()
    register(ipc, { fetchImpl: async () => { throw new Error('redirect') } })
    const out = await ipc.invoke('jira:request', {
      url: 'https://acme.atlassian.net/rest/api/3/myself', method: 'GET',
      headers: { Authorization: 'Bearer x' },
    })
    expect(out).toEqual({ ok: false, status: 0, headers: {}, body: '', error: 'redirect' })
  })

  it('returns network errors instead of throwing across IPC', async () => {
    const ipc = makeFakeIpcMain()
    register(ipc, { fetchImpl: async () => { throw new Error('ENOTFOUND') } })
    expect(await ipc.invoke('jira:request', { url: 'https://acme.atlassian.net/rest/api/3/myself' }))
      .toEqual({ ok: false, status: 0, headers: {}, body: '', error: 'ENOTFOUND' })
  })
})
