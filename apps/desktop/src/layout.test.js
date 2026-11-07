import { describe, it, expect } from 'vitest'
import { effectiveSidebar, SIDEBAR_BREAKPOINT, orderedNav, visibleNav, toggledSidebar, mountedViews, KEEP_ALIVE_VIEWS, mergeNavOrder, sidebarGroups, placedNav } from './layout.js'

describe('mergeNavOrder', () => {
  it('keeps the places of apps that are not installed', () => {
    expect(mergeNavOrder(['a', 'x', 'b', 'y', 'c'], ['c', 'a', 'b'])).toEqual(['c', 'x', 'a', 'y', 'b'])
  })
  it('appends shown ids missing from the stored order, and copes with no stored order', () => {
    expect(mergeNavOrder(['a'], ['b', 'a'])).toEqual(['b', 'a'])
    expect(mergeNavOrder(undefined, ['a', 'b'])).toEqual(['a', 'b'])
  })
})

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

describe('mountedViews', () => {
  const keep = new Set(['db'])
  it('keeps a visited kept-alive view mounted while another view is shown', () => {
    expect(mountedViews(['db'], 'git', keep)).toEqual(['db', 'git'])
  })
  it('renders the current view once, in its first-visit place', () => {
    expect(mountedViews(['db'], 'db', keep)).toEqual(['db'])
    expect(mountedViews([], 'db', keep)).toEqual(['db'])
    expect(mountedViews(['git'], 'git', keep)).toEqual(['git'])
  })
  it('drops ordinary views once left', () => {
    expect(mountedViews(['dashboard', 'db'], 'git', keep)).toEqual(['db', 'git'])
  })
})

describe('the Git Workspace is kept alive', () => {
  it('stays mounted, with its open files and selections, while another screen is shown', () => {
    expect(KEEP_ALIVE_VIEWS.has('git')).toBe(true)
    expect(mountedViews(['git', 'dashboard'], 'dashboard')).toContain('git')
    expect(mountedViews(['git', 'dashboard'], 'dashboard')).toEqual(['git', 'dashboard'])
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

describe('visibleNav', () => {
  const NAV = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

  it('leaves out hidden entries and keeps the stored order of the rest', () => {
    expect(visibleNav(['c', 'a', 'b'], ['a'], NAV).map(i => i.id)).toEqual(['c', 'b'])
  })
  it('shows everything when nothing is hidden, or the list is missing or malformed', () => {
    for (const hidden of [[], undefined, null, 'a']) expect(visibleNav(['b', 'a', 'c'], hidden, NAV).map(i => i.id)).toEqual(['b', 'a', 'c'])
  })
  it('ignores hidden ids that are no longer entries, and can hide them all', () => {
    expect(visibleNav(undefined, ['gone'], NAV).map(i => i.id)).toEqual(['a', 'b', 'c'])
    expect(visibleNav(undefined, ['a', 'b', 'c'], NAV)).toEqual([])
  })
  it('shows a newly added entry even though the stored order lacks it', () => {
    expect(visibleNav(['b'], ['b'], NAV).map(i => i.id)).toEqual(['a', 'c'])
  })
})

describe('isBareStandalone', () => {
  it('drops the sidebar only for one app with one screen', async () => {
    const { isBareStandalone } = await import('./layout.js')
    expect(isBareStandalone('standalone', 1)).toBe(true)
    expect(isBareStandalone('standalone', 7)).toBe(false)   // Work keeps its sidebar
    expect(isBareStandalone('combined', 1)).toBe(false)
  })
})

describe('sidebarGroups', () => {
  const NAV = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
  const ids = g => ({ main: g.main.map(i => i.id), more: g.more.map(i => i.id), footer: g.footer.map(i => i.id) })

  it('starts with every screen in the main sidebar, in the saved order', () => {
    expect(ids(sidebarGroups(NAV, { order: ['c', 'a', 'b', 'd'] }))).toEqual({ main: ['c', 'a', 'b', 'd'], more: [], footer: [] })
  })

  it('moves placed screens to More or the footer, keeping the order inside each group', () => {
    const g = sidebarGroups(NAV, { order: ['d', 'c', 'b', 'a'], placement: { a: 'more', c: 'more', b: 'footer' } })
    expect(ids(g)).toEqual({ main: ['d'], more: ['c', 'a'], footer: ['b'] })
  })

  it('placement naming a missing id is ignored', () => {
    const g = sidebarGroups(NAV, { placement: { ghost: 'more', b: 'footer', c: 'nowhere' } })
    expect(ids(g)).toEqual({ main: ['a', 'c', 'd'], more: [], footer: ['b'] })
  })

  it('leaves out hidden and switched-off screens wherever they are placed', () => {
    const g = sidebarGroups(NAV, { placement: { a: 'more', b: 'footer' }, hidden: ['a'], off: ['b', 'c'] })
    expect(ids(g)).toEqual({ main: ['d'], more: [], footer: [] })
  })

  it('placedNav keeps hidden screens, for the Settings editor', () => {
    const g = placedNav(['a', 'b', 'c', 'd'], { b: 'more' }, NAV)
    expect(ids(g)).toEqual({ main: ['a', 'c', 'd'], more: ['b'], footer: [] })
  })
})
