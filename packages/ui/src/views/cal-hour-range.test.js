import { describe, it, expect } from 'vitest'
import { calHourRange } from './view-calendar.jsx'

const day = new Date(2026, 10, 2)
const key = '2026-11-02'
const at = (h, m = 0) => `${key}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`

describe('calHourRange', () => {
  it('keeps 7am to 8pm when events fit', () => {
    expect(calHourRange([day], { [key]: [{ start: at(9), end: at(10) }] })).toEqual([7, 20])
  })
  it('stretches for late and early events', () => {
    expect(calHourRange([day], { [key]: [{ start: at(18), end: at(22, 30) }, { start: at(5, 30), end: at(6) }] })).toEqual([5, 23])
  })
  it('ignores all-day events and runs to midnight when an event crosses it', () => {
    expect(calHourRange([day], { [key]: [{ start: key, end: key }] })).toEqual([7, 20])
    expect(calHourRange([day], { [key]: [{ start: at(21), end: '2026-11-03T01:00' }] })).toEqual([7, 24])
  })
})
