import { test, expect } from '@playwright/test'
import { launchApp } from './launch.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const appRow = (win, label) => win.locator('.set-row').filter({ has: win.locator('.t', { hasText: new RegExp('^' + label + '$') }) })
const openApps = async (win) => {
  await win.getByText('Settings').first().click()
  await win.getByText('Desktop', { exact: true }).click()
  await expect(win.getByRole('heading', { name: 'Apps' })).toBeVisible()
}
const savedOff = (app) => app.evaluate(({ app: a }) => a.getPath('userData')).then(dir => JSON.parse(readFileSync(join(dir, 'prefs.json'), 'utf8')).disabledApps)

test('a switched-off app is left out, and turning it on needs a restart only because it was off at start', async () => {
  const { app, win, close } = await launchApp({ prefs: { disabledApps: ['git'] } })
  try {
    await expect(win.getByText('Dashboard').first()).toBeVisible({ timeout: 15_000 })
    // Neither its sidebar entry nor its main-process bridge is there.
    await expect(win.locator('button.nav-item', { hasText: 'Git Workspace' })).toHaveCount(0)
    expect(await win.evaluate(() => typeof window.electronAPI.git)).toBe('undefined')

    await openApps(win)
    const gitRow = appRow(win, 'Git Workspace')
    const gitSwitch = gitRow.locator('input[type=checkbox]')
    await expect(gitSwitch).not.toBeChecked()

    await gitRow.locator('label.tgl').click()
    await expect(gitSwitch).toBeChecked()
    // Its code was never loaded, so it comes on after a restart, and the card says so.
    await expect(win.getByText('Restart to turn on')).toBeVisible()
    await expect(win.getByRole('button', { name: 'Restart now' })).toBeVisible()
    await expect.poll(() => savedOff(app)).toEqual([])
  } finally { await close() }
})

test('switching a running app off and on again is instant: its sidebar entry goes and returns, with no restart and no reload', async () => {
  const { app, win, close } = await launchApp()
  try {
    await expect(win.locator('button.nav-item', { hasText: 'Git Workspace' })).toHaveCount(1, { timeout: 15_000 })
    // Anything the page holds in memory would be lost by a reload; this survives only if there is none.
    await win.evaluate(() => { window.__noReloadMarker = 'still here' })

    await openApps(win)
    const gitRow = appRow(win, 'Git Workspace')
    await gitRow.locator('label.tgl').click()
    await expect(gitRow.locator('input[type=checkbox]')).not.toBeChecked()
    await expect(win.locator('button.nav-item', { hasText: 'Git Workspace' })).toHaveCount(0)
    await expect(win.getByRole('button', { name: 'Restart now' })).toHaveCount(0)
    await expect.poll(() => savedOff(app)).toEqual(['git'])

    await gitRow.locator('label.tgl').click()
    await expect(gitRow.locator('input[type=checkbox]')).toBeChecked()
    await expect(win.locator('button.nav-item', { hasText: 'Git Workspace' })).toHaveCount(1)
    await expect(win.getByRole('button', { name: 'Restart now' })).toHaveCount(0)
    await expect.poll(() => savedOff(app)).toEqual([])
    expect(await win.evaluate(() => window.__noReloadMarker)).toBe('still here')
  } finally { await close() }
})

test('turning an app off while its own screen is showing moves to another screen instead of leaving a blank one', async () => {
  const { win, close } = await launchApp()
  try {
    await win.locator('button.nav-item', { hasText: 'Git Workspace' }).evaluate(b => b.click())
    await expect(win.locator('header.topbar h1')).toHaveText('Git Workspace', { timeout: 15_000 })
    await openApps(win)
    await appRow(win, 'Git Workspace').locator('label.tgl').click()
    await win.locator('button.nav-item', { hasText: 'Dashboard' }).evaluate(b => b.click())
    await expect(win.locator('header.topbar h1')).not.toHaveText('Git Workspace')
    await expect(win.locator('button.nav-item', { hasText: 'Git Workspace' })).toHaveCount(0)
  } finally { await close() }
})
