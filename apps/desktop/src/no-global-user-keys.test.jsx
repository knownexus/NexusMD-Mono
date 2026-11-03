// Every piece of user data belongs to a profile: with a profile active, opening the screens that
// keep state must only write `nexusmd.p.<active>.*` (or a key the shell owns: the profile registry,
// the account, secure storage, feature flags, or an explicit machine key).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act } from 'react'

const ACTIVE = 'P1'
const ALLOWED = [
  new RegExp(`^nexusmd\.p\.${ACTIVE}\.`),
  /^nexusmd\.profiles$/, /^nexusmd\.activeProfileId$/,
  /^nexusmd\.account\./, /^nexusmd\.sec\./, /^nexusmd\.feature\./,
  // Machine keys: this install's own state, never user data.
  /^nexusmd\.sync\./, /^nexusmd\.oauth\.pending$/,
]

const SCREENS = ['settings', 'db-manager', 'markdown', 'team', 'dashboard']

describe('no global user keys', () => {
  beforeEach(() => {
    vi.resetModules()
    window.localStorage.clear()
    window.localStorage.setItem('nexusmd.profiles', JSON.stringify([{ id: ACTIVE, name: 'Work', initials: 'WK', color: '#9a7e22', type: 'ado', createdAt: 1 }]))
    window.localStorage.setItem('nexusmd.activeProfileId', ACTIVE)
    window.localStorage.setItem('nexusmd.account.optOut', '1')
    document.body.innerHTML = '<div id="root"></div>'
  })

  it('writes nothing outside the active profile while Settings, Databases, Markdown, Team and Dashboard open', async () => {
    const written = new Set()
    const realSet = Storage.prototype.setItem
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (k, v) { written.add(String(k)); return realSet.call(this, k, v) })

    await act(async () => { await import('./main.jsx') })
    for (const view of SCREENS) {
      await act(async () => {
        window.dispatchEvent(new CustomEvent('nexusmd:navigate', { detail: view }))
        await new Promise(r => setTimeout(r, 50))
      })
      if (view === 'settings') {
        // Collapsing a Settings card remembers it; Ctrl+B changes a tweak (the sidebar).
        await act(async () => {
          document.querySelector('.set-card-toggle')?.click()
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true }))
          await new Promise(r => setTimeout(r, 50))
        })
      }
    }
    spy.mockRestore()

    const offenders = [...written].filter(k => !ALLOWED.some(re => re.test(k)))
    expect(offenders).toEqual([])
    // The test is only meaningful if the screens did write something of the profile's.
    expect([...written].some(k => k.startsWith(`nexusmd.p.${ACTIVE}.`))).toBe(true)
    expect(written).toContain(`nexusmd.p.${ACTIVE}.tweaks`)
    expect(written).toContain(`nexusmd.p.${ACTIVE}.settings.collapsed`)
  })
})
