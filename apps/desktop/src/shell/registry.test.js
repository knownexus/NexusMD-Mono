import { describe, it, expect } from 'vitest'
import { buildRegistry, installedIdsFromHost, isUninstalledView, resolveView, BUNDLED_MANIFESTS } from './registry.js'

// The sidebar order users have always had; the manifests must reproduce it exactly.
const ORIGINAL_NAV_ORDER = [
  'dashboard', 'calendar', 'work', 'prs', 'builds', 'tests', 'team', 'triage',
  'planner', 'notes', 'markdown', 'api-client', 'db-manager', 'devenv', 'git',
]
// The Editor is new, so it comes after everything users already have.
const WITH_EDITOR = [...ORIGINAL_NAV_ORDER, 'editor', 'time']

describe('bundled apps', () => {
  it('reproduces the original sidebar order when everything is installed', () => {
    expect(buildRegistry().nav.map(n => n.id)).toEqual(WITH_EDITOR)
  })
  it('gives every view to exactly one app', () => {
    const owners = BUNDLED_MANIFESTS.flatMap(a => a.nav.map(n => n.id))
    expect(new Set(owners).size).toBe(owners.length)
  })
  it('keeps Calendar and Planner separate from Work', () => {
    const r = buildRegistry()
    expect(r.appForView('calendar').id).toBe('calendar')
    expect(r.appForView('planner').id).toBe('planner')
    expect(r.appForView('prs').id).toBe('work')
  })
})

describe('installed subset', () => {
  it('shows only the installed apps\' entries, standalone for one', () => {
    const r = buildRegistry(['git'])
    expect(r.nav.map(n => n.id)).toEqual(['git'])
    expect(r.mode).toBe('standalone')
    expect(r.identity.productName).toBe('NexusMD Git Workspace')
  })
  it('is combined for two or more, in the usual order', () => {
    const r = buildRegistry(['git', 'planner', 'calendar'])
    expect(r.mode).toBe('combined')
    expect(r.nav.map(n => n.id)).toEqual(['calendar', 'planner', 'git'])
  })
})

describe('isUninstalledView', () => {
  const git = buildRegistry(['git'])
  it('is true for a known view whose app is missing', () => {
    expect(isUninstalledView('dashboard', git)).toBe(true)
  })
  it('is true for a view nobody owns, since no installed app can show it', () => {
    expect(isUninstalledView('nope', git)).toBe(true)
  })
  it('is false for an installed app\'s view and for the shell\'s own Settings', () => {
    expect(isUninstalledView('git', git)).toBe(false)
    expect(isUninstalledView('settings', git)).toBe(false)
  })
})

describe('installedIdsFromHost', () => {
  it('uses the main process answer', () => {
    expect(installedIdsFromHost({ registry: { get: () => ({ installedIds: ['git'] }) } })).toEqual(['git'])
  })
  it('falls back to everything with no bridge or an unusable answer', () => {
    expect(installedIdsFromHost(undefined)).toBeNull()
    expect(installedIdsFromHost({})).toBeNull()
    expect(installedIdsFromHost({ registry: { get: () => ({ installedIds: null }) } })).toBeNull()
    expect(installedIdsFromHost({ registry: { get: () => ({ installedIds: [] }) } })).toBeNull()
    expect(installedIdsFromHost({ registry: { get: () => { throw new Error('x') } } })).toBeNull()
  })
})

describe('Calendar and Planner as apps of their own', () => {
  it('own their views, separate from Work', () => {
    const r = buildRegistry()
    expect(r.appForView('calendar').id).toBe('calendar')
    expect(r.appForView('planner').id).toBe('planner')
  })
  it('can be installed without Work, and Work without them', () => {
    expect(buildRegistry(['planner', 'calendar']).nav.map(n => n.id)).toEqual(['calendar', 'planner'])
    expect(buildRegistry(['work']).nav.map(n => n.id)).toEqual(['dashboard', 'work', 'prs', 'builds', 'tests', 'team', 'triage'])
  })
})

describe('resolveView', () => {
  it('turns the web app\'s view names into the desktop\'s, and leaves the rest', () => {
    expect(resolveView('pr')).toBe('prs')
    expect(resolveView('prs')).toBe('prs')
    expect(resolveView('triage')).toBe('triage')
    expect(resolveView(null)).toBeNull()
  })
  it('only ever names a view an app owns', () => {
    expect(isUninstalledView(resolveView('pr'))).toBe(false)
  })
})
