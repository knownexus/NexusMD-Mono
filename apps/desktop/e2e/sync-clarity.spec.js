import { test, expect } from '@playwright/test'
import { launchApp } from './launch.js'

// Sync that says what is going on. Without an account server only the parts that do not need one can be seen here: the
// "open Settings on this tab" link that the conflict notice's Review button and the sidebar badge use, and the Local data card's new name.
// (The counts, the disabled Save and the badge's states are covered by unit tests against a real sync engine.)

const settingsTab = (win, name) => win.locator('nav button', { hasText: name })
const openSettings = (win, tab) => win.evaluate(t => window.dispatchEvent(new CustomEvent('nexusmd:open-settings', { detail: { tab: t } })), tab)

test('openSettings shows Settings on the asked tab, from another screen and when Settings is already open', async () => {
  const { win, close } = await launchApp()
  try {
    await expect(win.locator('button.nav-item').first()).toBeVisible({ timeout: 30_000 })
    // From another screen: Settings is not mounted yet, so the tab waits for it.
    await openSettings(win, 'data')
    await expect(win.getByText('Local data', { exact: true })).toBeVisible()
    // Already open on another tab: it switches.
    await settingsTab(win, 'Appearance').click()
    await expect(win.getByText('Local data', { exact: true })).toHaveCount(0)
    await openSettings(win, 'data')
    await expect(win.getByText('Local data', { exact: true })).toBeVisible()
    // An unknown tab leaves it where it is.
    await openSettings(win, 'nope')
    await expect(win.getByText('Local data', { exact: true })).toBeVisible()
  } finally { await close() }
})
