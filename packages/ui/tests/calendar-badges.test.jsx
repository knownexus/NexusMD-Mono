import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import React from 'react'
import { AgendaView } from '../src/index.js'

afterEach(() => { cleanup(); vi.useRealTimers() })

const day = new Date(2026, 10, 3)
const ev = (id, start, end) => ({ id, title: id, type: 'meeting', start, end })
const renderAgenda = (events) => render(
  <AgendaView agendaDays={[day]} eventsByDay={{ '2026-11-03': events }} today="2026-11-03" onEventClick={() => {}} />
)

describe('calendar Now and Soon badges', () => {
  it('shows Now for an in-progress event and Soon for one starting within 30 minutes, then refreshes', () => {
    vi.useFakeTimers({ now: new Date(2026, 10, 3, 10, 30) })
    renderAgenda([
      ev('Standup', '2026-11-03T10:00', '2026-11-03T11:00'),
      ev('Review', '2026-11-03T10:45', '2026-11-03T11:30'),
      ev('Later', '2026-11-03T15:00', '2026-11-03T16:00'),
    ])
    expect(screen.getAllByText('Now')).toHaveLength(1)
    expect(screen.getAllByText('Soon')).toHaveLength(1)
    act(() => { vi.advanceTimersByTime(20 * 60000) })
    expect(screen.getAllByText('Now')).toHaveLength(2)
    expect(screen.queryByText('Soon')).toBeNull()
  })
})
