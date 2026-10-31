import { describe, it, expect } from 'vitest'
import { relockDelay, RELOCK_AFTER_MS } from './view-notes.jsx'

describe('notes auto re-lock', () => {
  it('follows the Settings switch: 15 minutes when on, never when off or unset', () => {
    expect(RELOCK_AFTER_MS).toBe(15 * 60 * 1000)
    expect(relockDelay('1')).toBe(RELOCK_AFTER_MS)
    expect(relockDelay('0')).toBeNull()
    expect(relockDelay(null)).toBeNull()
  })
})
