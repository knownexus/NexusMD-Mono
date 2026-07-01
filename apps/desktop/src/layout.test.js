import { describe, it, expect } from 'vitest'
import { effectiveSidebar, SIDEBAR_BREAKPOINT } from './layout.js'

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
