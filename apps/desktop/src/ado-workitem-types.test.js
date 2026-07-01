import { describe, it, expect, beforeEach } from 'vitest'
import { getCachedDefs, setCachedDefs } from './ado-workitem-types.js'

beforeEach(() => {
  localStorage.clear()
})

describe('getCachedDefs / setCachedDefs', () => {
  it('returns null when nothing is cached', () => {
    expect(getCachedDefs('ProjectA', 'Bug')).toBe(null)
  })

  it('round-trips a defs object', () => {
    const defs = { fields: [{ referenceName: 'System.Title' }], paths: { areas: [], iterations: [] }, types: [], fetchedAt: 123 }
    setCachedDefs('ProjectA', 'Bug', defs)
    expect(getCachedDefs('ProjectA', 'Bug')).toEqual(defs)
  })

  it('keys are isolated per project+type', () => {
    setCachedDefs('ProjectA', 'Bug', { fields: [], paths: {}, types: [], fetchedAt: 1 })
    expect(getCachedDefs('ProjectA', 'Task')).toBe(null)
    expect(getCachedDefs('ProjectB', 'Bug')).toBe(null)
  })
})
