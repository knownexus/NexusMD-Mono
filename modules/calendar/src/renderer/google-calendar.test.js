import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockBindingInstance = {
  isConnected: vi.fn(() => true),
  getToken: vi.fn(async () => 'fake-google-token'),
}

import { configureGoogleCalendar, fetchGoogleCalendarEvents, createGoogleCalendarEvent, deleteGoogleCalendarEvent, isGoogleConnected } from './google-calendar.js'

beforeEach(() => configureGoogleCalendar(() => mockBindingInstance))

beforeEach(() => {
  global.fetch = vi.fn()
  mockBindingInstance.isConnected.mockReturnValue(true)
  mockBindingInstance.getToken.mockResolvedValue('fake-google-token')
})

describe('fetchGoogleCalendarEvents', () => {
  it('maps Google events to the app event shape', async () => {
    global.fetch.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ items: [{ id: 'g1', summary: 'Design Review', start: { dateTime: '2026-07-02T09:00:00Z' }, end: { dateTime: '2026-07-02T10:00:00Z' }, location: 'HQ' }] }),
    })
    const result = await fetchGoogleCalendarEvents('2026-07-01T00:00:00.000Z', '2026-07-08T00:00:00.000Z')
    expect(result).toEqual([
      { id: 'google-g1', title: 'Design Review', start: '2026-07-02T09:00:00Z', end: '2026-07-02T10:00:00Z', type: 'meeting', source: 'google', description: 'HQ', personName: null, personId: null, plannerSection: null },
    ])
  })

  it('returns an empty array without calling fetch when there is no token', async () => {
    mockBindingInstance.getToken.mockResolvedValue(null)
    const result = await fetchGoogleCalendarEvents('a', 'b')
    expect(result).toEqual([])
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('throws on a non-ok response', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 500 })
    await expect(fetchGoogleCalendarEvents('a', 'b')).rejects.toThrow('Google Calendar events failed: 500')
  })
})

describe('createGoogleCalendarEvent', () => {
  it('POSTs the event and returns the response body', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'new-g-id' }) })
    const result = await createGoogleCalendarEvent({ title: 'Standup', start: '2026-07-02T09:00:00Z', end: '2026-07-02T09:15:00Z', description: 'Daily' })
    expect(result).toEqual({ id: 'new-g-id' })
    const [url, options] = global.fetch.mock.calls[0]
    expect(url).toBe('https://www.googleapis.com/calendar/v3/calendars/primary/events')
    expect(options.method).toBe('POST')
    const body = JSON.parse(options.body)
    expect(body.summary).toBe('Standup')
  })

  it('throws when there is no token', async () => {
    mockBindingInstance.getToken.mockResolvedValue(null)
    await expect(createGoogleCalendarEvent({ title: 'x', start: 'a', end: 'b' })).rejects.toThrow('Not connected to Google.')
  })
})

describe('deleteGoogleCalendarEvent', () => {
  it('sends a DELETE request', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 204 })
    await deleteGoogleCalendarEvent('g1')
    const [url, options] = global.fetch.mock.calls[0]
    expect(url).toContain('/events/g1')
    expect(options.method).toBe('DELETE')
  })

  it('treats a 410 Gone response as success', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 410 })
    await expect(deleteGoogleCalendarEvent('g1')).resolves.toBeUndefined()
  })

  it('throws on other non-ok responses', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 500 })
    await expect(deleteGoogleCalendarEvent('g1')).rejects.toThrow('Google Calendar delete failed: 500')
  })
})

describe('isGoogleConnected', () => {
  it('delegates to the native Google binding', () => {
    mockBindingInstance.isConnected.mockReturnValue(false)
    expect(isGoogleConnected()).toBe(false)
  })
})
