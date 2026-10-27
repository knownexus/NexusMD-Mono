import { describe, it, expect, vi } from 'vitest'
import { validateManifest, createRegistry, createCapabilities } from './index.js'

const app = (id, extra = {}) => ({
  id, label: id.toUpperCase(), productName: `NexusMD ${id}`,
  nav: [{ id, label: id, icon: 'pin' }], ...extra,
})

describe('validateManifest', () => {
  it('accepts a complete manifest', () => {
    expect(validateManifest(app('git'))).toEqual([])
  })
  it('reports each problem', () => {
    expect(validateManifest(null)).toHaveLength(1)
    expect(validateManifest({ id: 'Bad Id', label: '', productName: '', nav: 'x' }).length).toBeGreaterThanOrEqual(4)
    expect(validateManifest({ ...app('a'), nav: [{ id: 'a' }] })).toContain('every nav entry needs id, label and icon')
  })
})

describe('createRegistry', () => {
  const manifests = [app('b', { order: 2 }), app('a', { order: 1 }), app('c', { order: 3 })]

  it('treats a missing installed list as everything, ordered by manifest.order', () => {
    const r = createRegistry({ manifests })
    expect(r.apps.map(a => a.id)).toEqual(['a', 'b', 'c'])
    expect(r.nav.map(n => n.id)).toEqual(['a', 'b', 'c'])
    expect(r.mode).toBe('combined')
    expect(r.identity).toEqual({ productName: 'NexusMD', appId: 'combined' })
  })
  it('is standalone with one app and takes that app\'s identity', () => {
    const r = createRegistry({ manifests, installedIds: ['b'] })
    expect(r.mode).toBe('standalone')
    expect(r.identity).toEqual({ productName: 'NexusMD b', appId: 'b' })
    expect(r.isInstalled('a')).toBe(false)
    expect(r.appForView('a')).toBeUndefined()
    expect(r.appForView('b').id).toBe('b')
  })
  it('leaves out switched-off apps but keeps the mode and identity of what is installed', () => {
    const r = createRegistry({ manifests, installedIds: ['a', 'b'], disabledIds: ['a'] })
    expect(r.apps.map(a => a.id)).toEqual(['b'])
    expect(r.installedApps.map(a => a.id)).toEqual(['a', 'b'])
    expect(r.isInstalled('a')).toBe(false)
    expect(r.appForView('a')).toBeUndefined()
    expect(r.mode).toBe('combined')
    expect(r.identity.appId).toBe('combined')
  })
  it('runs every installed app if all of them are switched off', () => {
    const r = createRegistry({ manifests, disabledIds: ['a', 'b', 'c'] })
    expect(r.apps.map(a => a.id)).toEqual(['a', 'b', 'c'])
  })
  it('ignores installed ids it does not know about', () => {
    expect(createRegistry({ manifests, installedIds: ['a', 'zzz'] }).apps.map(a => a.id)).toEqual(['a'])
  })
  it('keeps manifest position for equal order', () => {
    const r = createRegistry({ manifests: [app('x'), app('y')] })
    expect(r.apps.map(a => a.id)).toEqual(['x', 'y'])
  })
  it('lets one app contribute several nav entries', () => {
    const work = app('work', { nav: [{ id: 'dashboard', label: 'D', icon: 'i' }, { id: 'prs', label: 'P', icon: 'i' }] })
    const r = createRegistry({ manifests: [work] })
    expect(r.nav.map(n => n.id)).toEqual(['dashboard', 'prs'])
    expect(r.appForView('prs').id).toBe('work')
  })
  it('lets a nav entry\'s own order interleave apps and hides the order field', () => {
    const work = app('work', { order: 1, nav: [{ id: 'dashboard', label: 'D', icon: 'i', order: 0 }, { id: 'work', label: 'W', icon: 'i', order: 2 }] })
    const cal = app('calendar', { order: 5, nav: [{ id: 'calendar', label: 'C', icon: 'i', order: 1 }] })
    const nav = createRegistry({ manifests: [work, cal] }).nav
    expect(nav.map(n => n.id)).toEqual(['dashboard', 'calendar', 'work'])
    expect(nav[0]).toEqual({ id: 'dashboard', label: 'D', icon: 'i' })
  })
  it('rejects invalid and duplicate manifests', () => {
    expect(() => createRegistry({ manifests: [{ id: 'x' }] })).toThrow(/Invalid manifest "x"/)
    expect(() => createRegistry({ manifests: [app('a'), app('a')] })).toThrow(/Duplicate/)
  })
})

describe('createCapabilities', () => {
  it('reports and calls provided capabilities', () => {
    const c = createCapabilities()
    expect(c.has('editor.openPath')).toBe(false)
    const fn = vi.fn(() => 'ok')
    c.provide('editor.openPath', fn)
    expect(c.has('editor.openPath')).toBe(true)
    expect(c.call('editor.openPath', 'a.txt', 3)).toBe('ok')
    expect(fn).toHaveBeenCalledWith('a.txt', 3)
  })
  it('throws when calling something nobody provides', () => {
    expect(() => createCapabilities().call('nope')).toThrow(/not available/)
  })
  it('unregisters only its own provider', () => {
    const c = createCapabilities()
    const off = c.provide('x', () => 1)
    c.provide('x', () => 2)
    off()
    expect(c.call('x')).toBe(2)
  })
})
