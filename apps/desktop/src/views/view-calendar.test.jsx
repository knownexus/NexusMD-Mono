import React from 'react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

vi.mock('../google-calendar.js', () => ({
  createGoogleCalendarEvent: vi.fn(),
  isGoogleConnected: vi.fn(() => true),
  fetchGoogleCalendarEvents: vi.fn(async () => []),
  deleteGoogleCalendarEvent: vi.fn(),
}))

import * as googleCalendar from '../google-calendar.js'
import { MicrosoftCalendarBanner, GoogleCalendarBanner, NewGoogleEventModal, CalendarView } from './view-calendar.jsx'

afterEach(() => { cleanup(); vi.clearAllMocks() })
// vi.clearAllMocks() resets call history but NOT mockReturnValue/mockImplementation
// overrides set by individual tests (e.g. `.mockReturnValue(false)`), which would
// otherwise silently leak into later tests. Reset the shared default explicitly.
beforeEach(() => { googleCalendar.isGoogleConnected.mockReturnValue(true) })

describe('MicrosoftCalendarBanner', () => {
  it('shows a syncing indicator when syncing', () => {
    render(<MicrosoftCalendarBanner connected syncing error={null} onRefresh={() => {}} />)
    expect(screen.getByText(/Outlook/)).toBeTruthy()
  })

  it('shows an error message when there is a sync error', () => {
    render(<MicrosoftCalendarBanner connected syncing={false} error="token expired" onRefresh={() => {}} />)
    expect(screen.getByTitle('token expired')).toBeTruthy()
  })

  it('renders nothing when not connected', () => {
    const { container } = render(<MicrosoftCalendarBanner connected={false} syncing={false} error={null} onRefresh={() => {}} />)
    expect(container.firstChild).toBe(null)
  })

  it('calls onRefresh when the refresh button is clicked', () => {
    const onRefresh = vi.fn()
    render(<MicrosoftCalendarBanner connected syncing={false} error={null} onRefresh={onRefresh} />)
    fireEvent.click(screen.getByTitle('Refresh Outlook Calendar'))
    expect(onRefresh).toHaveBeenCalled()
  })
})

describe('GoogleCalendarBanner', () => {
  it('renders nothing when Google is not connected', () => {
    googleCalendar.isGoogleConnected.mockReturnValue(false)
    const { container } = render(<GoogleCalendarBanner syncing={false} error={null} onRefresh={() => {}} />)
    expect(container.firstChild).toBe(null)
  })

  it('shows connected status when Google is connected', () => {
    googleCalendar.isGoogleConnected.mockReturnValue(true)
    render(<GoogleCalendarBanner syncing={false} error={null} onRefresh={() => {}} />)
    expect(screen.getByText('Google Calendar')).toBeTruthy()
  })
})

describe('NewGoogleEventModal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<NewGoogleEventModal open={false} onClose={() => {}} onCreated={() => {}} />)
    expect(container.firstChild).toBe(null)
  })

  it('creates a Google event with the entered title and calls onCreated', async () => {
    googleCalendar.createGoogleCalendarEvent.mockResolvedValue({ id: 'new-id' })
    const onCreated = vi.fn()
    const onClose = vi.fn()
    render(<NewGoogleEventModal open={true} defaultDate="2026-07-02" defaultTime="09:00" onClose={onClose} onCreated={onCreated} />)

    fireEvent.change(screen.getByPlaceholderText('Event title'), { target: { value: 'Team sync' } })
    fireEvent.click(screen.getByText('Create event'))

    await waitFor(() => expect(googleCalendar.createGoogleCalendarEvent).toHaveBeenCalled())
    expect(googleCalendar.createGoogleCalendarEvent.mock.calls[0][0].title).toBe('Team sync')
    expect(onCreated).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('does not submit with an empty title', () => {
    render(<NewGoogleEventModal open={true} onClose={() => {}} onCreated={() => {}} />)
    expect(screen.getByText('Create event').closest('button').disabled).toBe(true)
  })
})

describe('CalendarView (local events only)', () => {
  it('defaults to week view and shows a Today button', () => {
    render(<CalendarView calendarEvents={[]} setCalendarEvents={() => {}} onNavigatePlanner={() => {}} />)
    expect(screen.getByText('Today')).toBeTruthy()
  })

  it('switches to month view when the Month button is clicked', () => {
    render(<CalendarView calendarEvents={[]} setCalendarEvents={() => {}} onNavigatePlanner={() => {}} />)
    fireEvent.click(screen.getByText('Month'))
    expect(document.querySelector('.cal-view-btn.active').textContent).toBe('Month')
  })

  it('renders a local event chip and opens the detail modal on click', () => {
    const events = [{ id: 'local-1', title: 'Retro', start: `${new Date().toISOString().slice(0, 10)}T14:00:00.000Z`, end: `${new Date().toISOString().slice(0, 10)}T15:00:00.000Z`, source: 'local' }]
    render(<CalendarView calendarEvents={events} setCalendarEvents={() => {}} onNavigatePlanner={() => {}} />)
    fireEvent.click(screen.getByText('Retro'))
    // EventDetailModal's root has id="modal-event-detail" — check for it directly rather than
    // re-querying the event title text, which now appears twice (chip + modal) and would throw.
    expect(document.getElementById('modal-event-detail')).toBeTruthy()
  })

  it('deletes a local event via the detail modal and updates calendarEvents', () => {
    const setCalendarEvents = vi.fn()
    const events = [{ id: 'local-1', title: 'Retro', start: `${new Date().toISOString().slice(0, 10)}T14:00:00.000Z`, end: `${new Date().toISOString().slice(0, 10)}T15:00:00.000Z`, source: 'local' }]
    render(<CalendarView calendarEvents={events} setCalendarEvents={setCalendarEvents} onNavigatePlanner={() => {}} />)
    fireEvent.click(screen.getByText('Retro'))
    // The modal's Delete button requires a two-step confirm: first click reveals
    // "Delete this event?" with a second Delete button; only the second click deletes.
    fireEvent.click(screen.getByText('Delete'))
    fireEvent.click(screen.getByText('Delete'))
    expect(setCalendarEvents).toHaveBeenCalled()
  })
})

vi.mock('../ms-graph-calendar.js', () => ({
  fetchCalendarEvents: vi.fn(async () => []),
  createCalendarEvent: vi.fn(),
}))
vi.mock('../cloud-auth.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    makeDesktopOAuthService: vi.fn(() => ({
      isConnected: vi.fn(() => true),
      getToken: vi.fn(async () => 'ms-token'),
    })),
  }
})

import * as msGraphCalendar from '../ms-graph-calendar.js'

describe('CalendarView Outlook + Google wiring', () => {
  it('fetches Outlook events on mount when Microsoft is connected', async () => {
    render(<CalendarView calendarEvents={[]} setCalendarEvents={() => {}} onNavigatePlanner={() => {}} />)
    await waitFor(() => expect(msGraphCalendar.fetchCalendarEvents).toHaveBeenCalled())
    const passedGetToken = msGraphCalendar.fetchCalendarEvents.mock.calls[0][0]
    expect(typeof passedGetToken).toBe('function')
    await expect(passedGetToken()).resolves.toBe('ms-token')
  })

  it('fetches Google events on mount when Google is connected', async () => {
    render(<CalendarView calendarEvents={[]} setCalendarEvents={() => {}} onNavigatePlanner={() => {}} />)
    await waitFor(() => expect(googleCalendar.fetchGoogleCalendarEvents).toHaveBeenCalled())
  })

  it('renders a merged Outlook event chip', async () => {
    const todayIso = new Date().toISOString().slice(0, 10)
    msGraphCalendar.fetchCalendarEvents.mockResolvedValueOnce([
      { id: 'outlook-1', title: 'All-Hands', start: `${todayIso}T13:00:00.000Z`, end: `${todayIso}T14:00:00.000Z`, type: 'meeting', personId: null, personName: null, plannerSection: null, description: '', source: 'outlook' },
    ])
    render(<CalendarView calendarEvents={[]} setCalendarEvents={() => {}} onNavigatePlanner={() => {}} />)
    expect(await screen.findByText('All-Hands')).toBeTruthy()
  })

  it('shows the New event button and opens the modal when Google is connected', async () => {
    render(<CalendarView calendarEvents={[]} setCalendarEvents={() => {}} onNavigatePlanner={() => {}} />)
    fireEvent.click(screen.getByTitle('New Google Calendar event'))
    expect(screen.getByText('New Google Calendar event', { selector: 'div' })).toBeTruthy()
  })

  it('does not show the New event button when Google is not connected', () => {
    googleCalendar.isGoogleConnected.mockReturnValue(false)
    render(<CalendarView calendarEvents={[]} setCalendarEvents={() => {}} onNavigatePlanner={() => {}} />)
    expect(screen.queryByTitle('New Google Calendar event')).toBe(null)
  })
})
