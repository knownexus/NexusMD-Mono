import { test, expect } from '@playwright/test'
import { launchApp } from './launch.js'

// Settings that arrive from another computer by sync (a page hidden there) are taken in on screen without reloading the window.
// The sync writes the merged value under the profile and AccountGate announces it on the nexusmd:sync-applied event; this plays both parts.

const nav = (win, label) => win.locator('button.nav-item', { hasText: label })
const announce = (win, collId) => win.evaluate(id => document.dispatchEvent(new CustomEvent('nexusmd:sync-applied', { detail: { collId: id } })), collId)
const mark = (win) => win.evaluate(() => { window.__noReloadMarker = 'still here' })
const marker = (win) => win.evaluate(() => window.__noReloadMarker)

test('a sidebar entry hidden on another computer disappears here, and comes back, with no reload', async () => {
  const { win, close } = await launchApp()
  try {
    await expect(nav(win, 'Git Workspace')).toHaveCount(1, { timeout: 30_000 })
    await mark(win)

    // What the sync writes when the other computer hid Git Workspace.
    await win.evaluate(() => {
      const key = Object.keys(localStorage).find(k => /\.p\.[^.]+\.tweaks$/.test(k))
      const base = key ? JSON.parse(localStorage.getItem(key)) : {}
      localStorage.setItem(key || 'nexusmd.p.e2e.tweaks', JSON.stringify({ ...base, navHidden: ['git'] }))
    })
    await announce(win, 'tweaks')
    await expect(nav(win, 'Git Workspace')).toHaveCount(0)
    expect(await marker(win)).toBe('still here')

    await win.evaluate(() => {
      const key = Object.keys(localStorage).find(k => /\.p\.[^.]+\.tweaks$/.test(k))
      localStorage.setItem(key, JSON.stringify({ ...JSON.parse(localStorage.getItem(key)), navHidden: [] }))
    })
    await announce(win, 'tweaks')
    await expect(nav(win, 'Git Workspace')).toHaveCount(1)
    expect(await marker(win)).toBe('still here')
  } finally { await close() }
})

test('a Work screen switched off on another computer goes here too, with no reload', async () => {
  const { win, close } = await launchApp()
  try {
    await expect(nav(win, 'Triage')).toHaveCount(1, { timeout: 30_000 })
    await mark(win)
    await win.evaluate(() => {
      const id = localStorage.getItem('nexusmd.activeProfileId')
      localStorage.setItem('nexusmd.p.' + id + '.work.screens.off', JSON.stringify(['triage']))
    })
    await announce(win, 'work-screens')
    await expect(nav(win, 'Triage')).toHaveCount(0)
    expect(await marker(win)).toBe('still here')
  } finally { await close() }
})
