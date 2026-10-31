import { describe, it, expect, vi } from 'vitest'
vi.mock('./cloud-auth.js', () => ({ getOAuthToken: vi.fn() }))
import { fetchGoogleEvents, toCalendarEvent } from './google-calendar.js'

const ok = (body) => ({ ok: true, status: 200, json: async () => body })
const range = [new Date('2026-11-02T00:00:00Z'), new Date('2026-11-09T00:00:00Z')]

describe('google calendar', () => {
  it('maps server events to calendar events', () => {
    expect(toCalendarEvent({ id: 'a', title: 'Standup', start: 's', end: 'e', location: 'Room 1' }))
      .toMatchObject({ id: 'google-a', source: 'google', description: 'Room 1', title: 'Standup' })
    expect(toCalendarEvent({ id: 'b', start: 's', end: 'e' }).title).toBe('(No title)')
  })
  it('fetches the date range with the token', async () => {
    const fetchFn = vi.fn().mockResolvedValue(ok([{ id: '1', title: 'x', start: 's', end: 'e' }]))
    const evs = await fetchGoogleEvents(...range, { token: async () => 'tok', fetchFn })
    expect(fetchFn.mock.calls[0][0]).toMatch(/token=tok&start=2026-11-02&end=2026-11-09$/)
    expect(evs).toHaveLength(1)
  })
  it('refreshes the token once on 401', async () => {
    const token = vi.fn().mockResolvedValueOnce('old').mockResolvedValueOnce('new')
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: false, status: 401 }).mockResolvedValueOnce(ok([]))
    await fetchGoogleEvents(...range, { token, fetchFn })
    expect(token.mock.calls[1][1]).toEqual({ force: true })
    expect(fetchFn.mock.calls[1][0]).toContain('token=new')
  })
  it('throws the server error message', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'no calendar scope' }) })
    await expect(fetchGoogleEvents(...range, { token: async () => 't', fetchFn })).rejects.toThrow('no calendar scope')
  })
  it('throws when not signed in', async () => {
    await expect(fetchGoogleEvents(...range, { token: async () => null, fetchFn: vi.fn() })).rejects.toThrow('401')
  })
})
