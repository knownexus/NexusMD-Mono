import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createCapabilities } from '@nexusmd/shell-sdk'
import calendar, { scheduleMeeting } from './index.js'
import * as msGraph from './ms-graph-calendar.js'

const start = new Date(2026, 9, 26, 10, 0, 0)
const end = new Date(2026, 9, 26, 11, 0, 0)

const hostWith = (connected, getToken = vi.fn(async () => 't')) => ({
  capabilities: createCapabilities(),
  cloud: {
    makeOAuthService: vi.fn(() => ({ isConnected: () => connected, getToken })),
    makeNativeGoogleBinding: vi.fn(),
  },
})

beforeEach(() => vi.restoreAllMocks())

describe('calendar.scheduleMeeting', () => {
  it('is offered to other apps once the Calendar activates', () => {
    const host = hostWith(true)
    calendar.activate(host)
    expect(host.capabilities.has('calendar.scheduleMeeting')).toBe(true)
  })
  it('puts the meeting on Outlook when signed in to Microsoft', async () => {
    const create = vi.spyOn(msGraph, 'createCalendarEvent').mockResolvedValue({})
    const host = hostWith(true)
    expect(await scheduleMeeting(host, { title: '1:1 with Sam', start, end })).toBe(true)
    expect(create).toHaveBeenCalledWith(expect.any(Function), {
      title: '1:1 with Sam',
      start: msGraph.toLocalDateTimeString(start),
      end: msGraph.toLocalDateTimeString(end),
    })
  })
  it('does nothing, and says so, when not signed in', async () => {
    const create = vi.spyOn(msGraph, 'createCalendarEvent').mockResolvedValue({})
    expect(await scheduleMeeting(hostWith(false), { title: 'x', start, end })).toBe(false)
    expect(create).not.toHaveBeenCalled()
  })
  it('does not create the Google binding until it is needed', () => {
    const host = hostWith(true)
    calendar.activate(host)
    expect(host.cloud.makeNativeGoogleBinding).not.toHaveBeenCalled()
  })
})
