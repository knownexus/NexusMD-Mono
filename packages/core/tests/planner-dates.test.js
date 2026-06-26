import { describe, it, expect } from 'vitest'
import {
  PL_STATUSES, PL_PRIOS, PL_OPEN,
  plTodayDate, plParseYmd, plFmtYmd, plIsOverdueYmd, plIsTodayYmd, qaParseDue,
} from '../src/index.js'

describe('planner status constants', () => {
  it('PL_OPEN treats Done/Deferred as closed, everything else open', () => {
    expect(PL_OPEN('To Do')).toBe(true)
    expect(PL_OPEN('In Progress')).toBe(true)
    expect(PL_OPEN('Done')).toBe(false)
    expect(PL_OPEN('Deferred')).toBe(false)
    expect(PL_OPEN('')).toBe(true)
  })
  it('exposes the canonical status/priority lists', () => {
    expect(PL_STATUSES).toContain('Blocked')
    expect(PL_PRIOS[1]).toBe('1 - Critical')
  })
})

describe('ymd date helpers', () => {
  it('plFmtYmd / plParseYmd round-trip', () => {
    const d = new Date(2026, 0, 5) // 5 Jan 2026 local
    expect(plFmtYmd(d)).toBe('2026-01-05')
    expect(plParseYmd('2026-01-05').getTime()).toBe(d.getTime())
  })
  it('plParseYmd returns null on bad input', () => {
    expect(plParseYmd('')).toBeNull()
    expect(plParseYmd('not-a-date')).toBeNull()
    expect(plParseYmd(null)).toBeNull()
  })
  it('plTodayDate is at local midnight', () => {
    const t = plTodayDate()
    expect(t.getHours()).toBe(0)
    expect(t.getMinutes()).toBe(0)
  })

  it('plIsOverdueYmd: past + open = overdue; past + done = not', () => {
    const past = plFmtYmd(new Date(Date.now() - 5 * 86400000))
    expect(plIsOverdueYmd(past, 'To Do')).toBe(true)
    expect(plIsOverdueYmd(past, 'Done')).toBe(false)
  })
  it('plIsOverdueYmd: future is never overdue', () => {
    const future = plFmtYmd(new Date(Date.now() + 5 * 86400000))
    expect(plIsOverdueYmd(future, 'To Do')).toBe(false)
  })
  it('plIsTodayYmd matches today only', () => {
    expect(plIsTodayYmd(plFmtYmd(new Date()))).toBe(true)
    expect(plIsTodayYmd(plFmtYmd(new Date(Date.now() + 86400000)))).toBe(false)
  })
})

describe('qaParseDue', () => {
  it('parses today/tomorrow', () => {
    expect(qaParseDue('today')).toBe(plFmtYmd(plTodayDate()))
    const tmw = plTodayDate(); tmw.setDate(tmw.getDate() + 1)
    expect(qaParseDue('tmw')).toBe(plFmtYmd(tmw))
  })
  it('parses weekday names to the next occurrence (never today)', () => {
    const out = qaParseDue('mon')
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(plParseYmd(out).getDay()).toBe(1) // Monday
    expect(out).not.toBe(plFmtYmd(plTodayDate()))
  })
  it('parses dd/mm shorthand and iso passthrough', () => {
    const y = new Date().getFullYear()
    expect(qaParseDue('12/03')).toBe(`${y}-03-12`)
    expect(qaParseDue('2026-07-04')).toBe('2026-07-04')
  })
  it('returns null on garbage', () => {
    expect(qaParseDue('whenever')).toBeNull()
  })
})
