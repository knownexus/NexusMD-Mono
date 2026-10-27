import { test, expect } from '@playwright/test'
import { launchApp } from './launch.js'

const item = (win, label) => win.locator('button.nav-item', { hasText: label })
const heading = win => win.locator('header.topbar h1')
const screenRow = (win, label) => win.locator('.set-row').filter({ has: win.locator('.t', { hasText: new RegExp(`^${label}$`) }) })

async function openWorkScreens(win) {
  await item(win, 'Settings').evaluate(b => b.click())
  await win.getByRole('button', { name: 'Desktop', exact: true }).evaluate(b => b.click())
  await expect(win.locator('.set-card-toggle', { hasText: 'Work screens' })).toBeVisible({ timeout: 15_000 })
}

test('a Work screen switched off leaves the sidebar, can\'t be opened, and stays off', async () => {
  const { win, close } = await launchApp()
  try {
    await expect(item(win, 'Triage')).toHaveCount(1)
    await openWorkScreens(win)
    const triage = screenRow(win, 'Triage')
    await triage.locator('label.tgl').click()
    await expect(triage.locator('input[type=checkbox]')).not.toBeChecked()
    await expect(triage).toContainText('Off — hidden')

    // Gone from the sidebar at once; the rest of Work stays.
    await expect(item(win, 'Triage')).toHaveCount(0)
    await expect(item(win, 'Team')).toHaveCount(1)

    // A link to it (as the Dashboard's widgets send) does nothing.
    await win.evaluate(() => window.dispatchEvent(new CustomEvent('nexusmd:navigate', { detail: { view: 'triage' } })))
    await expect(heading(win)).toHaveText('Settings')

    await win.reload()
    await expect(item(win, 'Dashboard')).toHaveCount(1, { timeout: 15_000 })
    await expect(item(win, 'Triage')).toHaveCount(0)

    // Switched back on, it returns.
    await openWorkScreens(win)
    await screenRow(win, 'Triage').locator('label.tgl').click()
    await expect(item(win, 'Triage')).toHaveCount(1)
  } finally { await close() }
})

test('switching off the screen the app starts on opens the next one instead', async () => {
  const { win, close } = await launchApp()
  try {
    await openWorkScreens(win)
    await screenRow(win, 'Dashboard').locator('label.tgl').click()
    await expect(item(win, 'Dashboard')).toHaveCount(0)
    await win.reload()
    // Dashboard was the start screen; now the app opens on the first sidebar entry still on.
    await expect(item(win, 'Settings')).toHaveCount(1, { timeout: 15_000 })
    // The entry's text also carries its shortcut number and any count, so compare the start.
    const first = (await win.locator('button.nav-item').first().innerText()).trim()
    const shown = (await heading(win).innerText()).trim()
    expect(shown).not.toBe('Dashboard')
    expect(first.startsWith(shown)).toBe(true)
  } finally { await close() }
})
