import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { splitApps } from './split-info.js'

describe('splitApps', () => {
  it('is what the main process reports for apps installed as folders', () => {
    const apps = [{ id: 'git', manifest: { id: 'git' }, rendererUrl: 'file:///x/index.js', styles: [] }]
    expect(splitApps({ registry: { get: () => ({ installedIds: ['git'], split: { apps } }) } })).toEqual(apps)
  })
  it('is empty in the all-in-one build, with no bridge, or with an unusable answer', () => {
    expect(splitApps({ registry: { get: () => ({ installedIds: null, split: null }) } })).toEqual([])
    expect(splitApps({ registry: { get: () => ({ installedIds: null }) } })).toEqual([])
    expect(splitApps({})).toEqual([])
    expect(splitApps(undefined)).toEqual([])
    expect(splitApps({ registry: { get: () => { throw new Error('x') } } })).toEqual([])
    expect(splitApps({ registry: { get: () => ({ split: { apps: 'nope' } }) } })).toEqual([])
  })
})

describe('the split app sources', () => {
  const apps = [
    { id: 'a', manifest: { id: 'a', label: 'A' }, rendererUrl: 'data:text/javascript,export default { id: "a" }', styles: ['file:///a/style.css'] },
    { id: 'broken', manifest: { id: 'broken', label: 'B' }, rendererUrl: 'data:text/javascript,throw new Error("boom")', styles: ['file:///a/style.css', 'file:///b/style.css'] },
    { id: 'nodefault', manifest: { id: 'nodefault', label: 'N' }, rendererUrl: 'data:text/javascript,export const x = 1', styles: [] },
  ]
  beforeEach(() => {
    vi.resetModules()
    window.electronAPI = { registry: { get: () => ({ installedIds: apps.map(a => a.id), split: { apps } }) } }
    document.head.replaceChildren()
  })
  afterEach(() => { delete window.electronAPI; vi.restoreAllMocks() })

  it('takes the manifests of the apps whose code loaded, so a broken app leaves no empty sidebar entry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { appManifests } = await import('./app-manifests.split.js')
    expect(appManifests.map(m => m.id)).toEqual(['a'])
  })

  it('has no manifests when there is no split layout', async () => {
    window.electronAPI = { registry: { get: () => ({ installedIds: null, split: null }) } }
    const { appManifests } = await import('./app-manifests.split.js')
    expect(appManifests).toEqual([])
  })

  it('loads each app\'s code from its own folder, and leaves out one that fails or has no default export', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { appModules } = await import('./app-code.split.js')
    expect(appModules).toEqual([{ id: 'a' }])
    expect(error).toHaveBeenCalledTimes(2)
    expect(error.mock.calls.map(c => c[0]).join(' ')).toMatch(/"broken".*"nodefault"/)
  })

  it('adds each stylesheet once', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await import('./app-code.split.js')
    const hrefs = [...document.head.querySelectorAll('link[rel=stylesheet]')].map(l => l.href)
    expect(hrefs).toEqual(['file:///a/style.css', 'file:///b/style.css'])
  })

  it('has no apps, and loads nothing, when there is no split layout', async () => {
    window.electronAPI = { registry: { get: () => ({ installedIds: null, split: null }) } }
    const { appModules } = await import('./app-code.split.js')
    expect(appModules).toEqual([])
  })
})
