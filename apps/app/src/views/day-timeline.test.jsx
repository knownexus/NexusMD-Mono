import React from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import { DayTimeline } from './day-timeline.jsx'

afterEach(cleanup)

const ev = (id, title, a, b) => ({ id, title, start: `2026-10-31T${a}`, end: `2026-10-31T${b}` })

describe('DayTimeline', () => {
  it('puts a short event on one row so its title is not squeezed out', () => {
    render(<DayTimeline events={[ev(1, 'Standup', '10:00', '10:15'), ev(2, 'Workshop', '13:00', '16:00')]} isToday={false}/>)
    expect(screen.getByText('Standup').closest('button').className).toContain('short')
    expect(screen.getByText('Workshop').closest('button').className).not.toContain('short')
  })

  it('marks events that share the same time as narrow, so only their titles show', () => {
    render(<DayTimeline events={[ev(1, 'Planning', '09:00', '10:30'), ev(2, 'Sync', '09:30', '09:45')]} isToday={false}/>)
    expect(screen.getByText('Planning').closest('button').className).toContain('narrow')
    expect(screen.getByText('Sync').closest('button').className).toContain('narrow')
  })
})
