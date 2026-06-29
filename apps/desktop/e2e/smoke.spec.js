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
})
