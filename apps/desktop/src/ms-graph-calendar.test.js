import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchCalendarEvents, createCalendarEvent } from './ms-graph-calendar.js'

beforeEach(() => {
  global.fetch = vi.fn()
})

describe('fetchCalendarEvents', () => {
  it('maps Graph calendarView events to the app event shape', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        value: [
          { id: 'abc123', subject: 'Sprint Planning', start: { dateTime: '2026-07-02T09:00:00.0000000' }, end: { dateTime: '2026-07-02T10:00:00.0000000' }, location: { displayName: 'Room 4' } },
        ],
      }),
    })
    const result = await fetchCalendarEvents('fake-token', '2026-07-01T00:00:00.000Z', '2026-07-08T00:00:00.000Z')
    expect(result).toEqual([
      {
        id: 'outlook-abc123', title: 'Sprint Planning',
        start: '2026-07-02T09:00:00.0000000Z', end: '2026-07-02T10:00:00.0000000Z',
        type: 'meeting', personId: null, personName: null, plannerSection: null,
        description: 'Room 4', source: 'outlook',
      },
    ])
  })

  it('defaults the title when subject is missing', async () => {
    global.fetch.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ value: [{ id: 'x', start: { dateTime: '2026-07-02T09:00:00' }, end: { dateTime: '2026-07-02T10:00:00' } }] }),
    })
    const result = await fetchCalendarEvents('fake-token', 'a', 'b')
    expect(result[0].title).toBe('(No title)')
  })

  it('sends the Bearer token and date range in the request', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ value: [] }) })
    await fetchCalendarEvents('fake-token', '2026-07-01T00:00:00.000Z', '2026-07-08T00:00:00.000Z')
    const [url, options] = global.fetch.mock.calls[0]
    expect(url).toContain('calendarView')
    expect(url).toContain(encodeURIComponent('2026-07-01T00:00:00.000Z'))
    expect(options.headers.Authorization).toBe('Bearer fake-token')
  })

  it('throws on a non-ok response', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 401 })
    await expect(fetchCalendarEvents('fake-token', 'a', 'b')).rejects.toThrow('Graph calendarView failed: 401')
  })
})

describe('createCalendarEvent', () => {
  it('POSTs the event to Graph and returns the response body', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 201, json: async () => ({ id: 'new-event-id' }) })
    const result = await createCalendarEvent('fake-token', { title: '1:1 with Alex', start: '2026-07-02T10:00Z', end: '2026-07-02T11:00Z', description: 'Weekly sync' })
    expect(result).toEqual({ id: 'new-event-id' })
    const [url, options] = global.fetch.mock.calls[0]
    expect(url).toBe('https://graph.microsoft.com/v1.0/me/events')
    expect(options.method).toBe('POST')
    expect(options.headers.Authorization).toBe('Bearer fake-token')
    const body = JSON.parse(options.body)
    expect(body.subject).toBe('1:1 with Alex')
    expect(body.start.dateTime).toBe('2026-07-02T10:00')
    expect(body.body.content).toBe('Weekly sync')
  })

  it('throws on a non-ok response', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 403 })
    await expect(createCalendarEvent('fake-token', { title: 'x', start: 'a', end: 'b' })).rejects.toThrow('Graph createEvent failed: 403')
  })
})
