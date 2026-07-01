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
import { MicrosoftCalendarBanner, GoogleCalendarBanner, NewGoogleEventModal } from './view-calendar.jsx'

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
