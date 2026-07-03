import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OutlookService } from '../src/index.js'

const acquireTokenSilent = vi.fn()
const acquireTokenPopup = vi.fn()
const getAllAccounts = vi.fn(() => [])
const setActiveAccount = vi.fn()
const initialize = vi.fn(async () => {})

vi.mock('@azure/msal-browser', () => ({
  // NOTE: must be a `function`, not an arrow fn — vitest's mock invokes this via
  // `new PublicClientApplication()`, and arrow functions aren't constructible.
  PublicClientApplication: vi.fn().mockImplementation(function () {
    return {
      initialize,
      getAllAccounts,
      setActiveAccount,
      acquireTokenSilent,
      acquireTokenPopup,
    }
  }),
}))

beforeEach(async () => {
  vi.clearAllMocks()
  global.fetch = vi.fn()
  OutlookService.reset()
  await OutlookService.init('client-id')
  acquireTokenPopup.mockResolvedValue({ accessToken: 'popup-token', account: { name: 'Ada' } })
  await OutlookService.signIn()
})

describe('OutlookService (MSAL + shared Graph client)', () => {
  it('fetchWeekEvents acquires a token silently and calls Graph calendarView', async () => {
    acquireTokenSilent.mockResolvedValue({ accessToken: 'silent-token' })
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ value: [] }) })
    await OutlookService.fetchWeekEvents('2026-07-01T00:00:00.000Z', '2026-07-08T00:00:00.000Z')
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toContain('https://graph.microsoft.com/v1.0/me/calendarView')
    expect(opts.headers.Authorization).toBe('Bearer silent-token')
  })

  it('falls back to acquireTokenPopup when acquireTokenSilent rejects', async () => {
    acquireTokenSilent.mockRejectedValue(new Error('interaction required'))
    acquireTokenPopup.mockResolvedValue({ accessToken: 'popup-token-2', account: { name: 'Ada' } })
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ value: [] }) })
    await OutlookService.fetchWeekEvents('a', 'b')
    const [, opts] = global.fetch.mock.calls[0]
    expect(opts.headers.Authorization).toBe('Bearer popup-token-2')
  })

  it('retries once via forced popup re-acquisition on a 401 from Graph', async () => {
    acquireTokenSilent.mockResolvedValue({ accessToken: 'stale-token' })
    acquireTokenPopup.mockResolvedValue({ accessToken: 'fresh-token', account: { name: 'Ada' } })
    global.fetch
      .mockResolvedValueOnce({ ok: false, status: 401 })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ value: [] }) })
    await OutlookService.fetchWeekEvents('a', 'b')
    expect(global.fetch).toHaveBeenCalledTimes(2)
    expect(global.fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer fresh-token')
  })

  it('createEvent POSTs to Graph with the silently-acquired token', async () => {
    acquireTokenSilent.mockResolvedValue({ accessToken: 'silent-token' })
    global.fetch.mockResolvedValue({ ok: true, status: 201, json: async () => ({ id: 'evt-1' }) })
    const result = await OutlookService.createEvent({ title: '1:1', start: '2026-07-02T10:00Z', end: '2026-07-02T11:00Z' })
    expect(result).toEqual({ id: 'evt-1' })
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toBe('https://graph.microsoft.com/v1.0/me/events')
    expect(opts.method).toBe('POST')
  })
})
