import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import React from 'react'
import {
  getWeekDays, getMonthGrid, isoDate, todayStr, fmt12, layoutDayEvents,
  OutlookBanner,
} from '../src/index.js'

afterEach(cleanup)

describe('shared calendar layer (web + app)', () => {
  it('getWeekDays returns 7 days (or 5 for the work week), Monday-first', () => {
    const week = getWeekDays(0, false)
    expect(week).toHaveLength(7)
    expect(week[0].getDay()).toBe(1) // Monday
    expect(getWeekDays(0, true)).toHaveLength(5) // work week Mon–Fri
  })

  it('getMonthGrid returns a 6×7 grid with year/month', () => {
    const grid = getMonthGrid(0)
    expect(grid.days).toHaveLength(42)
    expect(typeof grid.year).toBe('number')
    expect(typeof grid.month).toBe('number')
  })

  it('isoDate formats a local YYYY-MM-DD and todayStr matches today', () => {
    const d = new Date(2026, 5, 28) // 2026-06-28 local
    expect(isoDate(d)).toBe('2026-06-28')
    expect(todayStr()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('fmt12 renders a 12-hour clock label', () => {
    expect(fmt12('2026-06-28T13:30:00Z')).toMatch(/\d/)
  })

  it('layoutDayEvents columns overlapping events side by side', () => {
    const evs = [
      { id: 'a', start: '2026-06-28T09:00:00', end: '2026-06-28T10:00:00', type: 'meeting' },
      { id: 'b', start: '2026-06-28T09:30:00', end: '2026-06-28T10:30:00', type: 'meeting' },
    ]
    const laid = layoutDayEvents(evs)
    expect(laid).toHaveLength(2)
    // Two overlapping events → at least 2 columns total.
    expect(Math.max(...laid.map(l => l.totalCols))).toBeGreaterThanOrEqual(2)
  })

  it('OutlookBanner: allowSetup=false hides the unconfigured setup affordance (app behaviour)', () => {
    const { container } = render(
      <OutlookBanner config={{ clientId: '' }} onSaveConfig={() => {}} connected={false}
        onConnect={() => {}} onDisconnect={() => {}} allowSetup={false} allowSignIn={false} />,
    )
    expect(container.textContent).toBe('')
  })

  it('OutlookBanner: allowSignIn=false omits the interactive "Sign in with Microsoft" button', () => {
    const { container } = render(
      <OutlookBanner config={{ clientId: 'abc' }} onSaveConfig={() => {}} connected={false}
        onConnect={() => {}} onDisconnect={() => {}} allowSetup={false} allowSignIn={false} />,
    )
    expect(container.textContent).not.toContain('Sign in with Microsoft')
  })

  it('OutlookBanner (web default): shows the setup affordance when unconfigured', () => {
    const { container } = render(
      <OutlookBanner config={{ clientId: '' }} onSaveConfig={() => {}} connected={false}
        onConnect={() => {}} onDisconnect={() => {}} />,
    )
    expect(container.textContent).toContain('Sign in with Microsoft')
  })
})
