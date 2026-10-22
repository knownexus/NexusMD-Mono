import { describe, it, expect } from 'vitest'
import { effectiveSidebar, SIDEBAR_BREAKPOINT, orderedNav, toggledSidebar } from './layout.js'

describe('effectiveSidebar', () => {
  it('forces icons below the breakpoint regardless of preference', () => {
    expect(effectiveSidebar(800, 'labels')).toBe('icons')
    expect(effectiveSidebar(800, 'icons')).toBe('icons')
  })
  it('honours the saved preference at or above the breakpoint', () => {
    expect(effectiveSidebar(SIDEBAR_BREAKPOINT, 'labels')).toBe('labels')
    expect(effectiveSidebar(1400, 'labels')).toBe('labels')
    expect(effectiveSidebar(1400, 'icons')).toBe('icons')
  })
  it('defaults to labels when preference is missing', () => {
    expect(effectiveSidebar(1400, undefined)).toBe('labels')
  })
})

describe('toggledSidebar', () => {
  it('collapses labels to icons and expands icons back to labels', () => {
    expect(toggledSidebar('labels')).toBe('icons')
    expect(toggledSidebar('icons')).toBe('labels')
    expect(toggledSidebar(undefined)).toBe('icons')
  })
})

describe('orderedNav', () => {
  const NAV = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

  it('orders items by navOrder', () => {
    expect(orderedNav(['c', 'a', 'b'], NAV).map(i => i.id)).toEqual(['c', 'a', 'b'])
  })
  it('appends nav items missing from a stored order', () => {
    expect(orderedNav(['b'], NAV).map(i => i.id)).toEqual(['b', 'a', 'c'])
  })
  it('drops stale ids not present in nav', () => {
    expect(orderedNav(['gone', 'a', 'b', 'c'], NAV).map(i => i.id)).toEqual(['a', 'b', 'c'])
  })
  it('falls back to full nav order when navOrder is missing', () => {
    expect(orderedNav(undefined, NAV).map(i => i.id)).toEqual(['a', 'b', 'c'])
    expect(orderedNav([], NAV).map(i => i.id)).toEqual(['a', 'b', 'c'])
  })
})
