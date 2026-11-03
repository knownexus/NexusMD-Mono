// Every piece of user data belongs to a profile: with a profile active, opening the screens that
// keep state must only write `nexusmd.p.<active>.*` (or a key the shell owns: the profile registry,
// the account, secure storage, feature flags, or an explicit machine key).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act } from 'react'

const ACTIVE = 'P1'
const ALLOWED = [
  new RegExp(`^nexusmd\\.p\\.${ACTIVE}\\.`),
  /^nexusmd\.profiles$/, /^nexusmd\.activeProfileId$/,
  /^nexusmd\.account\./, /^nexusmd\.sec\./, /^nexusmd\.feature\./,
  // Machine keys: this install's own state, never user data.
  /^nexusmd\.sync\./, /^nexusmd\.oauth\.pending$/,
  // Read-only device state the shell/core own: where profile files live, and fetched-data caches (not user data).
  /^nexusmd\.profileDir$/, /^nexusmd\.workitems\.status\.v1$/, /^nexusmd\.ado\.cache\.v1$/,
]

const HEADINGS = { settings: 'Settings', 'db-manager': 'Database Manager', markdown: 'Documents', team: 'Team', dashboard: 'Dashboard' }
const SCREENS = Object.keys(HEADINGS)
const isAllowed = k => ALLOWED.some(re => re.test(k))
const tick = (ms = 80) => new Promise(r => setTimeout(r, ms))
const buttons = () => [...document.querySelectorAll('button')]
const press = async (match) => {
  const b = buttons().find(x => (x.textContent.trim() === match || x.getAttribute('aria-label') === match || x.title === match))
  if (!b) throw new Error('no button: ' + match)
  await act(async () => { b.click(); await tick() })
}
const typeInto = async (el, value) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()
  })
}
const go = async (view) => {
  await act(async () => { window.dispatchEvent(new CustomEvent('nexusmd:navigate', { detail: view })); await tick() })
  // The screen really mounted (views stay mounted once visited, so look for its own heading).
  const headings = [...document.querySelectorAll('h1,h2')].map(h => h.textContent.trim())
  expect(headings, view + ' rendered').toContain(HEADINGS[view])
}

describe('no global user keys', () => {
  beforeEach(() => {
    vi.resetModules()
    window.localStorage.clear()
    window.localStorage.setItem('nexusmd.profiles', JSON.stringify([{ id: ACTIVE, name: 'Work', initials: 'WK', color: '#9a7e22', type: 'ado', createdAt: 1 }]))
    window.localStorage.setItem('nexusmd.activeProfileId', ACTIVE)
    window.localStorage.setItem('nexusmd.account.optOut', '1')
    document.body.innerHTML = '<div id="root"></div>'
  })

  it('reads and writes only the active profile through Settings, Databases, Markdown, Team and Dashboard', async () => {
    const written = new Set()
    const read = new Set()
    const realSet = Storage.prototype.setItem
    const realGet = Storage.prototype.getItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (k, v) { written.add(String(k)); return realSet.call(this, k, v) })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (k) { read.add(String(k)); return realGet.call(this, k) })

    await act(async () => { await import('./main.jsx') })

    // Settings: collapse a card, Ctrl+B (a tweak).
    await go('settings')
    await act(async () => {
      document.querySelector('.set-card-toggle').click()
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true }))
      await tick()
    })

    // Databases: open the demo, star a table, save a query.
    await go('db-manager')
    await press('Try the demo')
    await press('patients')
    await press('Star patients')
    await press('Query')
    await press('Search')   // the builder writes the SQL (the desktop's code editor can't be typed into here)
    await press('Build')
    await press('Save…')
    await typeInto(document.getElementById('db-save-name'), 'All patients')
    await press('Save query')

    // Documents: Learn mode and a bigger text size.
    await go('markdown')
    await press('Learn')
    await press('A+')

    // Team: add a person.
    await go('team')
    await press('Add member')
    await typeInto([...document.querySelectorAll('input')].find(i => i.placeholder === 'Jane Smith'), 'Zed Added')
    await press('Add manually')

    // Dashboard: it only reads user state (seenPr); the read spy below covers it.
    await go('dashboard')

    vi.restoreAllMocks()

    // Every real write landed in the profile, and nothing touched a bare user key.
    for (const name of ['tweaks', 'settings.collapsed', 'dbManager.tables.demo:/', 'dbManager.savedQueries', 'md_learn_mode', 'markdown.textSize', 'team.custom']) {
      expect(written, name).toContain(`nexusmd.p.${ACTIVE}.${name}`)
    }
    expect([...written].filter(k => !isAllowed(k))).toEqual([])
    expect([...read].filter(k => k.startsWith('nexusmd') || k.startsWith('nx-') || k.startsWith('md_')).filter(k => !isAllowed(k))).toEqual([])
  })
})
