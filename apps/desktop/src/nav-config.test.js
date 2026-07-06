import { describe, it, expect } from 'vitest'
import { NAV, SETTINGS_NAV, ALL_NAV, DEFAULT_NAV_ORDER } from './nav-config.js'

describe('nav-config', () => {
  it('NAV does not contain the settings item', () => {
    expect(NAV.find(n => n.id === 'settings')).toBeUndefined()
  })

  it('SETTINGS_NAV is the settings item', () => {
    expect(SETTINGS_NAV).toEqual({ id: 'settings', label: 'Settings', icon: 'settings' })
  })

  it('ALL_NAV appends settings after the reorderable items', () => {
    expect(ALL_NAV[ALL_NAV.length - 1]).toEqual(SETTINGS_NAV)
    expect(ALL_NAV.length).toBe(NAV.length + 1)
  })

  it('DEFAULT_NAV_ORDER mirrors NAV ids and excludes settings', () => {
    expect(DEFAULT_NAV_ORDER).toEqual(NAV.map(n => n.id))
    expect(DEFAULT_NAV_ORDER).not.toContain('settings')
  })

  it('renames the markdown item to Documents', () => {
    expect(NAV.find(n => n.id === 'markdown').label).toBe('Documents')
  })

  it('adds a top-level Notes item after planner', () => {
    const ids = NAV.map(n => n.id)
    expect(ids).toContain('notes')
    expect(ids.indexOf('notes')).toBe(ids.indexOf('planner') + 1)
  })
})
