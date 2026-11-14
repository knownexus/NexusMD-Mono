import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  getDisabledApps, setDisabledApps, isAppHidden, hiddenViewIds, refreshFromPrefs, resetDisabledApps,
} from './apps-disabled.js'
import { buildRegistry } from './registry.js'

beforeEach(() => resetDisabledApps())
afterEach(() => resetDisabledApps())

describe('the switched-off apps this window follows', () => {
  it('knows nothing until told', () => {
    expect(getDisabledApps()).toBeNull()
  })

  it('keeps what it is told, without repeats or rubbish, and tells whoever is listening', () => {
    setDisabledApps(['git', 'git', 3, 'planner'])
    expect(getDisabledApps()).toEqual(['git', 'planner'])
    setDisabledApps(null)
    expect(getDisabledApps()).toBeNull()
  })

  it('survives a reload of the window, which keeps session storage', () => {
    setDisabledApps(['git'])
    expect(JSON.parse(sessionStorage.getItem('nexusmd.apps.disabled'))).toEqual(['git'])
    // A new page reads it back.
    vi.resetModules()
    return import('./apps-disabled.js').then(fresh => { expect(fresh.getDisabledApps()).toEqual(['git']) })
  })

  it('takes the saved list from the main process', async () => {
    await refreshFromPrefs({ getDisabledApps: async () => ['work'] })
    expect(getDisabledApps()).toEqual(['work'])
  })

  it('keeps what it had when the saved list cannot be read, or is not a list', async () => {
    setDisabledApps(['git'])
    await refreshFromPrefs({ getDisabledApps: async () => { throw new Error('no bridge') } })
    await refreshFromPrefs({ getDisabledApps: async () => 'nope' })
    await refreshFromPrefs(undefined)
    expect(getDisabledApps()).toEqual(['git'])
  })
})

describe('hiding a running app', () => {
  const reg = buildRegistry(['git', 'work'])

  it('hides only an app that is running here, not one that was never loaded', () => {
    const startedWithGitOff = buildRegistry(['git', 'work'], ['git'])
    setDisabledApps(['git'])
    expect(isAppHidden('git', reg)).toBe(true)
    expect(isAppHidden('git', startedWithGitOff)).toBe(false)
    expect(isAppHidden('work', reg)).toBe(false)
  })

  it('names every sidebar entry of the apps switched off', () => {
    setDisabledApps(['git'])
    expect(hiddenViewIds(reg)).toEqual(['git'])
    setDisabledApps(['work'])
    expect(hiddenViewIds(reg)).toContain('prs')
    expect(hiddenViewIds(reg)).not.toContain('git')
  })

  it('names none when nothing is off, and when what is off is not running', () => {
    expect(hiddenViewIds(reg)).toEqual([])
    setDisabledApps(['planner'])
    expect(hiddenViewIds(reg)).toEqual([])
  })
})
