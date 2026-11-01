import React from 'react'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildEvent, defaultStart, localStamp, NewEventSheet } from './calendar-new-event.jsx'

afterEach(cleanup)

describe('building an event', () => {
  it('turns the form into an event with the right end time', () => {
    const r = buildEvent({ title: ' Team sync ', day: '2026-11-02', time: '14:30', length: 45 }, 'e1')
    expect(r.event).toEqual({ id: 'e1', title: 'Team sync', start: '2026-11-02T14:30', end: '2026-11-02T15:15', type: 'meeting', description: '' })
  })
  it('crosses midnight correctly', () => {
    expect(buildEvent({ title: 'Late', day: '2026-11-02', time: '23:30', length: 60 }).event.end).toBe('2026-11-03T00:30')
  })
  it('says what is wrong', () => {
    expect(buildEvent({ title: '  ', day: '2026-11-02', time: '10:00', length: 30 }).error).toMatch(/title/)
    expect(buildEvent({ title: 'x', day: '', time: '10:00', length: 30 }).error).toMatch(/day/)
    expect(buildEvent({ title: 'x', day: '2026-11-02', time: '', length: 30 }).error).toMatch(/start time/)
  })
  it('starts at the next whole hour today and 09:00 on another day', () => {
    const now = new Date(2026, 10, 2, 13, 20)
    expect(defaultStart('2026-11-02', now)).toBe('14:00')
    expect(defaultStart('2026-11-05', now)).toBe('09:00')
    expect(localStamp(new Date(2026, 0, 5, 7, 3))).toBe('2026-01-05T07:03')
  })
})

describe('New event sheet', () => {
  const mount = (over = {}) => {
    const onAdd = vi.fn(), onClose = vi.fn()
    render(<NewEventSheet open onClose={onClose} dayKey="2026-11-05" onAdd={onAdd} canAddToPlanner={() => true} outlookConnected={false} {...over}/>)
    return { onAdd, onClose }
  }
  it('refuses an empty title and keeps the sheet open', () => {
    const { onAdd, onClose } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Add event' }))
    expect(screen.getByRole('alert').textContent).toMatch(/title/)
    expect(onAdd).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled()
  })
  it('adds the event, with Planner when ticked', () => {
    const { onAdd, onClose } = mount()
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Retro' } })
    fireEvent.click(screen.getByLabelText(/Add to Planner/))
    fireEvent.click(screen.getByRole('button', { name: 'Add event' }))
    const [ev, opts] = onAdd.mock.calls[0]
    expect(ev.title).toBe('Retro'); expect(ev.start).toBe('2026-11-05T09:00')
    expect(opts).toEqual({ toPlanner: true, toOutlook: false, toGoogle: false })
    expect(onClose).toHaveBeenCalled()
  })
  it('offers Planner only for the planner week, and Outlook only when connected', () => {
    mount({ canAddToPlanner: () => false })
    expect(screen.getByLabelText(/Add to Planner/).disabled).toBe(true)
    expect(screen.queryByLabelText(/Save to Outlook/)).toBeNull()
    cleanup()
    mount({ outlookConnected: true })
    expect(screen.getByLabelText(/Save to Outlook/)).toBeTruthy()
  })
})
