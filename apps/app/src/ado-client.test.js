import { describe, it, expect, beforeEach } from 'vitest'
import { saveAdoConfig, getAdoConfig, usesAdoWorkItems } from './ado-client.js'

describe('usesAdoWorkItems', () => {
  beforeEach(() => localStorage.clear())

  it('is on by default once connected', () => {
    saveAdoConfig({ org: 'acme', pat: 'p', projects: ['P'] })
    expect(getAdoConfig().workItems).toBe(true)
    expect(usesAdoWorkItems()).toBe(true)
  })

  it('is off when the work items switch is off', () => {
    saveAdoConfig({ org: 'acme', pat: 'p', projects: ['P'], workItems: false })
    expect(usesAdoWorkItems()).toBe(false)
  })

  it('is off when ADO is not connected', () => {
    expect(usesAdoWorkItems()).toBe(false)
  })
})
