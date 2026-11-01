import { describe, it, expect, vi } from 'vitest'
vi.mock('./cloud-auth.js', () => ({ getOAuthToken: vi.fn() }))
import { fetchGoogleEvents, toCalendarEvent, createGoogleEvent } from './google-calendar.js'

const ok = (body) => ({ ok: true, status: 200, json: async () => body })
const range = [new Date('2026-11-02T00:00:00Z'), new Date('2026-11-09T00:00:00Z')]
const timed = { id: '1', summary: 'Standup', start: { dateTime: '2026-11-02T09:00:00Z' }, end: { dateTime: '2026-11-02T09:15:00Z' }, location: 'Room 1' }

describe('google calendar', () => {
  it('maps Google events to calendar events, timed and all-day', () => {
    expect(toCalendarEvent(timed)).toMatchObject({ id: 'google-1', source: 'google', title: 'Standup', description: 'Room 1', start: '2026-11-02T09:00:00Z' })
    const allDay = toCalendarEvent({ id: 'b', start: { date: '2026-11-03' }, end: { date: '2026-11-04' } })
    expect(allDay.title).toBe('(No title)')
    expect(allDay.start).toBe('2026-11-03')   // 10 characters: the calendar shows it as all-day
  })

  it('asks Google for the window, with the token as a Bearer header', async () => {
    const fetchFn = vi.fn().mockResolvedValue(ok({ items: [timed, { id: 'x', status: 'cancelled', start: { date: '2026-11-03' } }] }))
    const evs = await fetchGoogleEvents(...range, { token: async () => 'tok', fetchFn })
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toContain('https://www.googleapis.com/calendar/v3/calendars/primary/events?')
    expect(url).toContain('timeMin=2026-11-02T00%3A00%3A00.000Z')
    expect(url).toContain('timeMax=2026-11-09T00%3A00%3A00.000Z')
    expect(url).toContain('singleEvents=true')
    expect(init.headers.Authorization).toBe('Bearer tok')
    expect(evs.map(e => e.id)).toEqual(['google-1'])   // cancelled ones are dropped
  })

  it('refreshes the token once on 401', async () => {
    const token = vi.fn().mockResolvedValueOnce('old').mockResolvedValueOnce('new')
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: false, status: 401 }).mockResolvedValueOnce(ok({ items: [] }))
    await fetchGoogleEvents(...range, { token, fetchFn })
    expect(token.mock.calls[1][1]).toEqual({ force: true })
    expect(fetchFn.mock.calls[1][1].headers.Authorization).toBe('Bearer new')
  })

  it("throws Google's error message", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: { message: 'Calendar API has not been used in project' } }) })
    await expect(fetchGoogleEvents(...range, { token: async () => 't', fetchFn })).rejects.toThrow('Calendar API has not been used')
  })

  it('throws when not signed in', async () => {
    await expect(fetchGoogleEvents(...range, { token: async () => null, fetchFn: vi.fn() })).rejects.toThrow('401')
  })
})

describe('createGoogleEvent', () => {
  const ev = { title: 'Standup', start: '2026-11-02T09:00', end: '2026-11-02T09:30' }
  const ok = (body) => ({ ok: true, status: 200, json: async () => body })
  it('posts the event with the token and returns it as a calendar event', async () => {
    const calls = []
    const fetchFn = async (url, init) => { calls.push([url, init]); return ok({ id: 'g1', summary: 'Standup', start: { dateTime: '2026-11-02T09:00:00Z' }, end: { dateTime: '2026-11-02T09:30:00Z' } }) }
    const out = await createGoogleEvent(ev, { token: async () => 'tok', fetchFn })
    expect(calls[0][1].method).toBe('POST')
    expect(calls[0][1].headers.Authorization).toBe('Bearer tok')
    expect(JSON.parse(calls[0][1].body).summary).toBe('Standup')
    expect(out).toMatchObject({ id: 'google-g1', source: 'google', title: 'Standup' })
  })
  it('tells the user to sign in again when Google refuses the permission', async () => {
    const fetchFn = async () => ({ ok: false, status: 403, json: async () => ({}) })
    await expect(createGoogleEvent(ev, { token: async () => 'tok', fetchFn })).rejects.toThrow(/sign in again/)
  })
})
