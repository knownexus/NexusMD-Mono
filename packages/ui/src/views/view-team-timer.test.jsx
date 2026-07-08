import { describe, it, expect } from 'vitest'
import { composeTimerNote } from './view-team.jsx'

describe('composeTimerNote', () => {
  const start = new Date('2026-07-08T09:15:00').getTime()
  const stop  = new Date('2026-07-08T10:38:00').getTime()

  it('includes duration and a clock range', () => {
    const text = composeTimerNote({ elapsedMs: 83 * 60 * 1000, firstStartedAt: start, stoppedAt: stop, label: '' })
    expect(text).toBe('⏱ 1h 23m 0s (09:15–10:38)')
  })

  it('appends a label when provided', () => {
    const text = composeTimerNote({ elapsedMs: 83 * 60 * 1000, firstStartedAt: start, stoppedAt: stop, label: 'pairing on auth bug' })
    expect(text).toBe('⏱ 1h 23m 0s (09:15–10:38) — pairing on auth bug')
  })

  it('omits the range when start time is unknown', () => {
    const text = composeTimerNote({ elapsedMs: 30_000, firstStartedAt: null, stoppedAt: stop, label: '' })
    expect(text).toBe('⏱ 30s')
  })
})
