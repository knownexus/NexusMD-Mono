import { test, expect, _electron as electron } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test.describe('desktop shell smoke', () => {
  test('launches and renders the real shell (not the old placeholder)', async () => {
    const app = await electron.launch({ args: [appDir] })
    const win = await app.firstWindow()
    await win.waitForLoadState('domcontentloaded')

    // The real shell shows the NexusMD brand and nav; the old placeholder said
    // "Phase 6 complete — adapter layer wired." which must NOT appear.
    await expect(win.getByText('NexusMD').first()).toBeVisible({ timeout: 15_000 })
    await expect(win.getByText('Dashboard').first()).toBeVisible()
    await expect(win.getByText('Phase 6 complete')).toHaveCount(0)

    await app.close()
  })

  test('navigates between views', async () => {
    const app = await electron.launch({ args: [appDir] })
    const win = await app.firstWindow()
    await win.waitForLoadState('domcontentloaded')

    await win.getByText('Pull Requests').first().click()
    // Both the topbar and the PR view render a "Pull Requests" heading; .first()
    // keeps the locator unambiguous (strict mode) while still proving navigation.
    await expect(win.getByRole('heading', { name: 'Pull Requests' }).first()).toBeVisible()

    await app.close()
  })

  test('Settings shows the profile registry and Backup & Restore', async () => {
    const app = await electron.launch({ args: [appDir] })
    const win = await app.firstWindow()
    await win.waitForLoadState('domcontentloaded')

    await win.getByText('Settings').first().click()
    // VsProfiles (the default profile seeded on first run) + the new backup card.
    await expect(win.getByText('Default').first()).toBeVisible({ timeout: 15_000 })
    await expect(win.getByText('Backup & Restore')).toBeVisible()
    await expect(win.getByText('Back up all profiles')).toBeVisible()

    await app.close()
  })

  test('opens links as tabs in a shared link window', async () => {
    const app = await electron.launch({ args: [appDir] })
    const win = await app.firstWindow()
    await win.waitForLoadState('domcontentloaded')

    // Drive the link-window manager directly (same singleton main.cjs wires up
    // to IPC) rather than depending on live ADO data being loaded in the UI.
    const managerPath = resolve(appDir, 'electron/link-window/manager.cjs')
    const openTab = (title) => app.evaluate((_electron, { path, title }) => {
      require(path).openLink(`data:text/html,<title>${title}</title><body>${title}</body>`)
    }, { path: managerPath, title })

    await openTab('Tab One')
    const tabStrip = await app.waitForEvent('window', {
      predicate: (page) => page.url().endsWith('tab-strip.html'),
    })
    await tabStrip.waitForLoadState('domcontentloaded')
    await expect(tabStrip.locator('.tab')).toHaveCount(1)

    await openTab('Tab Two')
    await expect(tabStrip.locator('.tab')).toHaveCount(2)

    // Closing the active tab (Tab Two) falls back to the remaining tab.
    await tabStrip.locator('.tab', { hasText: 'Tab Two' }).locator('.tab-close').click()
    await expect(tabStrip.locator('.tab')).toHaveCount(1)
    await expect(tabStrip.locator('.tab')).toContainText('Tab One')

    // Closing the last tab closes the link window entirely.
    const linkWindowClosed = tabStrip.waitForEvent('close')
    await tabStrip.locator('.tab-close').click()
    await linkWindowClosed

    await app.close()
  })
})
