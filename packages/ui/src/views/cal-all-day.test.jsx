import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { WeekGrid } from './view-calendar.jsx'

afterEach(() => { cleanup(); vi.useRealTimers() })

const day = new Date(2026, 6, 2)
const key = '2026-07-02'

// An all-day event (date-only start, as the Outlook and Google mappers give it) in the week grid.
describe('WeekGrid all-day events', () => {
  it('draws an all-day event inside its day column, from the top, with no Now/Soon badge', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 6, 2, 12))
    const ev = { id: 'outlook-ad', title: 'Holiday', start: key, end: '2026-07-03', type: 'meeting', source: 'outlook' }
    const { container } = render(
      <WeekGrid days={[day]} eventsByDay={{ [key]: [ev] }} today={key} isCurrentPeriod scrollRef={{ current: null }} onEventClick={() => {}} />,
    )
    const col = container.querySelector('.cal-day-col')
    const block = container.querySelector('.cal-event')
    expect(block.textContent).toContain('Holiday')
    expect(block.textContent).not.toMatch(/Now|Soon/)
    expect(parseFloat(block.style.top)).toBe(0)
    expect(parseFloat(block.style.height)).toBeLessThanOrEqual(parseFloat(col.style.height))
  })
})
